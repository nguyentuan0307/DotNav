using System.Text.Json;

namespace DotNav.BuildHost.Protocol;

internal sealed record HostRequest(string? Id, string? Method, JsonElement Params);

internal sealed record HostError(string Code, string Message, string? Detail = null);

internal sealed record HostResponse(string? Id, object? Result = null, HostError? Error = null);

internal sealed record PingResult(int ProtocolVersion, string HostVersion, string MsbuildPath, string MsbuildVersion);

internal sealed record EvaluateRequest(
    IReadOnlyList<string>? EntryProjects,
    string? SolutionPath,
    IReadOnlyDictionary<string, string>? GlobalProperties);
