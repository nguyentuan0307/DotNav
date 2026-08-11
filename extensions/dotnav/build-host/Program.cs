using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using DotNav.BuildHost.Evaluation;
using DotNav.BuildHost.Protocol;
using Microsoft.Build.Locator;

const int ProtocolVersion = 2;
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

HostEnvironment instance;
try
{
    instance = ResolveDotnetSdk();
    MSBuildLocator.RegisterMSBuildPath(instance.MSBuildPath);
}
catch (Exception error)
{
    Console.Error.WriteLine($"Unable to locate MSBuild: {error}");
    return 2;
}

var evaluator = new MsbuildGraphEvaluator();
string? line;
while ((line = await Console.In.ReadLineAsync()) is not null)
{
    HostRequest? request = null;
    HostResponse response;
    try
    {
        request = JsonSerializer.Deserialize<HostRequest>(line, jsonOptions)
            ?? throw new InvalidOperationException("Request was empty.");
        response = request.Method switch
        {
            "ping" => new HostResponse(request.Id, new PingResult(
                ProtocolVersion,
                Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0",
                instance.MSBuildPath,
                instance.Version)),
            "evaluate" => Evaluate(request, evaluator, instance, jsonOptions),
            "shutdown" => new HostResponse(request.Id, new { shuttingDown = true }),
            _ => new HostResponse(request.Id, Error: new HostError("method-not-found", $"Unknown method '{request.Method}'."))
        };
    }
    catch (Exception error)
    {
        response = new HostResponse(request?.Id, Error: new HostError("host-error", error.Message, error.ToString()));
    }

    await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, jsonOptions));
    await Console.Out.FlushAsync();
    if (request?.Method == "shutdown") break;
}

return 0;

static HostResponse Evaluate(
    HostRequest request,
    MsbuildGraphEvaluator evaluator,
    HostEnvironment instance,
    JsonSerializerOptions options)
{
    var parameters = request.Params.Deserialize<EvaluateRequest>(options)
        ?? throw new InvalidOperationException("Evaluate parameters were missing.");
    var projects = parameters.EntryProjects ?? Array.Empty<string>();
    var properties = parameters.GlobalProperties ?? new Dictionary<string, string>();
    var graph = evaluator.Evaluate(projects, parameters.SolutionPath, properties, instance.MSBuildPath, instance.Version);
    return new HostResponse(request.Id, graph);
}

static HostEnvironment ResolveDotnetSdk()
{
    var dotnet = Environment.ProcessPath ?? throw new InvalidOperationException("Could not locate the dotnet host executable.");
    var selectedVersion = RunDotnet(dotnet, "--version").Trim();
    if (string.IsNullOrWhiteSpace(selectedVersion)) throw new InvalidOperationException("dotnet --version returned no SDK version.");
    var installed = RunDotnet(dotnet, "--list-sdks").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
    foreach (var line in installed)
    {
        var bracket = line.IndexOf('[');
        var closing = line.LastIndexOf(']');
        if (bracket <= 0 || closing <= bracket) continue;
        var version = line[..bracket].Trim();
        if (!string.Equals(version, selectedVersion, StringComparison.OrdinalIgnoreCase)) continue;
        var basePath = line[(bracket + 1)..closing].Trim();
        var sdkPath = Path.Combine(basePath, version);
        if (Directory.Exists(sdkPath)) return new HostEnvironment(sdkPath, version);
    }
    throw new InvalidOperationException($"The selected .NET SDK {selectedVersion} was not present in dotnet --list-sdks.");
}

static string RunDotnet(string executable, string argument)
{
    using var process = new System.Diagnostics.Process
    {
        StartInfo = new System.Diagnostics.ProcessStartInfo(executable, argument)
        {
            WorkingDirectory = Environment.CurrentDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        }
    };
    process.Start();
    var output = process.StandardOutput.ReadToEnd();
    var error = process.StandardError.ReadToEnd();
    process.WaitForExit();
    if (process.ExitCode != 0) throw new InvalidOperationException($"dotnet {argument} failed: {error.Trim()}");
    return output;
}

internal sealed record HostEnvironment(string MSBuildPath, string Version);
