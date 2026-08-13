using Microsoft.Build.Evaluation;
using Microsoft.Build.Execution;
using Microsoft.Build.Graph;
using Microsoft.Build.Construction;
using DotNav.BuildHost.Workspace;

namespace DotNav.BuildHost.Evaluation;

internal sealed class MsbuildGraphEvaluator
{
    private static readonly HashSet<string> InputItemTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "Compile", "Content", "None", "EmbeddedResource", "AdditionalFiles", "Analyzer", "ApplicationDefinition",
        "Page", "Resource", "SplashScreen", "TypeScriptCompile", "RazorGenerate",
        "RazorComponentWithTargetPath", "Protobuf", "OpenApiReference", "UpToDateCheckInput", "EditorConfigFiles",
        "GlobalAnalyzerConfigFiles"
    };

    private static readonly HashSet<string> CopyItemTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "Content", "None", "CopyToOutputDirectoryItem"
    };

    public BuildGraphModel Evaluate(
        IReadOnlyList<string> entryProjects,
        string? solutionPath,
        IReadOnlyDictionary<string, string> requestedGlobalProperties,
        string msbuildPath,
        string msbuildVersion)
    {
        if (entryProjects.Count == 0 && string.IsNullOrWhiteSpace(solutionPath))
        {
            throw new ArgumentException("At least one entry project is required.", nameof(entryProjects));
        }

        var globalProperties = new Dictionary<string, string>(requestedGlobalProperties, StringComparer.OrdinalIgnoreCase);
        globalProperties.TryAdd("Configuration", "Debug");
        globalProperties.TryAdd("Platform", "AnyCPU");

        var excludedSolutionProjects = new HashSet<string>(PathComparer);
        var entries = string.IsNullOrWhiteSpace(solutionPath)
            ? CreateProjectEntries(entryProjects, globalProperties)
            : CreateSolutionEntries(solutionPath, globalProperties, out excludedSolutionProjects);
        foreach (var entry in entries)
        {
            if (!File.Exists(entry.ProjectFile))
            {
                throw new FileNotFoundException("Project entry point was not found.", entry.ProjectFile);
            }
        }

        using var collection = new ProjectCollection();
        if (entries.Count == 0)
        {
            return new BuildGraphModel(2, msbuildPath, msbuildVersion, globalProperties, Array.Empty<ProjectVariantModel>());
        }
        var graph = new ProjectGraph(entries, collection, null);
        if (graph.ProjectNodes.Any(node => excludedSolutionProjects.Contains(Path.GetFullPath(node.ProjectInstance.FullPath))))
        {
            throw new NotSupportedException("An included solution project references a project excluded from the active solution configuration.");
        }
        var models = graph.ProjectNodesTopologicallySorted
            .Select(node => CreateModel(node, collection, globalProperties, msbuildPath))
            .ToArray();

        collection.UnloadAllProjects();
        return new BuildGraphModel(2, msbuildPath, msbuildVersion, globalProperties, models);
    }

    private static IReadOnlyList<ProjectGraphEntryPoint> CreateProjectEntries(
        IReadOnlyList<string> projectPaths,
        IReadOnlyDictionary<string, string> globalProperties) => projectPaths
        .Select(Path.GetFullPath)
        .Distinct(PathComparer)
        .Select(path => new ProjectGraphEntryPoint(path, new Dictionary<string, string>(globalProperties, StringComparer.OrdinalIgnoreCase)))
        .ToArray();

    private static IReadOnlyList<ProjectGraphEntryPoint> CreateSolutionEntries(
        string solutionPath,
        IReadOnlyDictionary<string, string> globalProperties,
        out HashSet<string> excludedProjects)
    {
        excludedProjects = new HashSet<string>(PathComparer);
        var fullPath = Path.GetFullPath(solutionPath);
        if (!string.Equals(Path.GetExtension(fullPath), ".sln", StringComparison.OrdinalIgnoreCase))
        {
            throw new NotSupportedException("Smart Build solution configuration evaluation currently requires a .sln file.");
        }
        var solution = SolutionFile.Parse(fullPath);
        var configuration = globalProperties.GetValueOrDefault("Configuration", "Debug");
        var platform = globalProperties.GetValueOrDefault("Platform", "AnyCPU");
        var entries = new List<ProjectGraphEntryPoint>();
        foreach (var project in solution.ProjectsInOrder.Where(item => item.ProjectType == SolutionProjectType.KnownToBeMSBuildFormat))
        {
            var mapping = project.ProjectConfigurations.FirstOrDefault(candidate =>
                IsSolutionConfiguration(candidate.Key, configuration, platform)).Value;
            if (mapping == null || !mapping.IncludeInBuild)
            {
                excludedProjects.Add(Path.GetFullPath(project.AbsolutePath));
                continue;
            }
            if (!string.Equals(mapping.ConfigurationName, configuration, StringComparison.OrdinalIgnoreCase)
                || !SamePlatform(mapping.PlatformName, platform))
            {
                throw new NotSupportedException("Per-project solution configuration remapping requires standard Build.");
            }
            var properties = new Dictionary<string, string>(globalProperties, StringComparer.OrdinalIgnoreCase)
            {
                ["Configuration"] = mapping.ConfigurationName,
                ["Platform"] = mapping.PlatformName
            };
            entries.Add(new ProjectGraphEntryPoint(Path.GetFullPath(project.AbsolutePath), properties));
        }
        if (entries.Count == 0)
        {
            throw new InvalidOperationException($"No buildable projects were mapped for solution configuration {configuration}|{platform}.");
        }
        return entries;
    }

    private static bool SamePlatform(string left, string right) => string.Equals(
        left.Replace(" ", string.Empty), right.Replace(" ", string.Empty), StringComparison.OrdinalIgnoreCase);

    private static bool IsSolutionConfiguration(string key, string configuration, string platform)
    {
        var separator = key.IndexOf('|');
        return separator > 0
            && string.Equals(key[..separator], configuration, StringComparison.OrdinalIgnoreCase)
            && SamePlatform(key[(separator + 1)..], platform);
    }

    private static ProjectVariantModel CreateModel(
        ProjectGraphNode node,
        ProjectCollection collection,
        IReadOnlyDictionary<string, string> globalProperties,
        string msbuildPath)
    {
        var instance = node.ProjectInstance;
        var projectPath = Path.GetFullPath(instance.FullPath);
        var projectDirectory = Path.GetDirectoryName(projectPath)!;
        var configuration = Value(instance, "Configuration", globalProperties.GetValueOrDefault("Configuration", "Debug"));
        var platform = Value(instance, "Platform", globalProperties.GetValueOrDefault("Platform", "AnyCPU"));
        var targetFramework = Value(instance, "TargetFramework");
        var runtimeIdentifier = Value(instance, "RuntimeIdentifier");
        var intermediateOutputPath = ResolvePath(projectDirectory, Value(instance, "IntermediateOutputPath"));
        var outputPath = ResolvePath(projectDirectory, Value(instance, "OutputPath", Value(instance, "OutDir")));
        var targetName = Value(instance, "TargetName", Path.GetFileNameWithoutExtension(projectPath));
        var targetExtension = Value(instance, "TargetExt", ".dll");
        var targetPath = ResolvePath(projectDirectory, Value(instance, "TargetPath"));
        if (string.IsNullOrEmpty(targetPath) && !string.IsNullOrEmpty(outputPath))
        {
            targetPath = Path.Combine(outputPath, targetName + targetExtension);
        }

        var referenceAssemblyPath = ResolvePath(projectDirectory, Value(instance, "TargetRefPath"));
        if (string.IsNullOrEmpty(referenceAssemblyPath) && !string.IsNullOrEmpty(intermediateOutputPath))
        {
            referenceAssemblyPath = Path.Combine(intermediateOutputPath, "ref", targetName + targetExtension);
        }

        var assetsFile = ResolvePath(projectDirectory, Value(instance, "ProjectAssetsFile"));
        if (string.IsNullOrEmpty(assetsFile) && !string.IsNullOrEmpty(intermediateOutputPath))
        {
            assetsFile = Path.Combine(intermediateOutputPath, "project.assets.json");
        }

        var inputs = new HashSet<string>(PathComparer) { projectPath };
        AddNonEmpty(inputs, assetsFile);
        var copies = new List<FileCopyModel>();
        foreach (var item in instance.Items)
        {
            if (string.Equals(item.ItemType, "Reference", StringComparison.OrdinalIgnoreCase))
            {
                var hintPath = ResolvePath(projectDirectory, item.GetMetadataValue("HintPath"));
                if (!string.IsNullOrEmpty(hintPath)) inputs.Add(hintPath);
            }
            if (InputItemTypes.Contains(item.ItemType))
            {
                var input = ResolvePath(projectDirectory, item.EvaluatedInclude);
                var isPotentialConfig = string.Equals(item.ItemType, "EditorConfigFiles", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(item.ItemType, "GlobalAnalyzerConfigFiles", StringComparison.OrdinalIgnoreCase);
                if (!string.IsNullOrEmpty(input) && (!isPotentialConfig || File.Exists(input))) inputs.Add(input);
            }

            if (CopyItemTypes.Contains(item.ItemType))
            {
                AddCopy(item, projectDirectory, outputPath, copies, inputs);
            }
        }

        var imports = LoadImports(projectPath, instance.GlobalProperties, collection)
            .Where(import => string.IsNullOrEmpty(intermediateOutputPath) || !IsPathInside(intermediateOutputPath, import))
            .ToArray();
        foreach (var import in imports)
        {
            inputs.Add(import);
        }
        foreach (var configurationFile in DiscoverConfigurationFiles(projectDirectory))
        {
            inputs.Add(configurationFile);
        }

        var outputs = new HashSet<string>(PathComparer);
        AddNonEmpty(outputs, targetPath);
        if (IsTrue(Value(instance, "ProduceReferenceAssembly"))) AddNonEmpty(outputs, referenceAssemblyPath);
        if (!string.IsNullOrEmpty(outputPath))
        {
            if (IsTrue(Value(instance, "DebugSymbols")) && !string.Equals(Value(instance, "DebugType"), "none", StringComparison.OrdinalIgnoreCase))
            {
                AddNonEmpty(outputs, Path.Combine(outputPath, targetName + ".pdb"));
            }
            if (IsTrue(Value(instance, "GenerateDependencyFile")))
            {
                var depsPath = ResolvePath(projectDirectory, Value(instance, "ProjectDepsFilePath"));
                AddNonEmpty(outputs, string.IsNullOrEmpty(depsPath) ? Path.Combine(outputPath, targetName + ".deps.json") : depsPath);
            }
            if (IsTrue(Value(instance, "GenerateRuntimeConfigurationFiles")))
            {
                var runtimeConfigPath = ResolvePath(projectDirectory, Value(instance, "ProjectRuntimeConfigFilePath"));
                AddNonEmpty(outputs, string.IsNullOrEmpty(runtimeConfigPath) ? Path.Combine(outputPath, targetName + ".runtimeconfig.json") : runtimeConfigPath);
            }
            if (IsTrue(Value(instance, "UseAppHost")))
            {
                var executableExtension = Value(instance, "ExecutableExtension",
                    OperatingSystem.IsWindows() ? ".exe" : string.Empty);
                AddNonEmpty(outputs, Path.Combine(outputPath, targetName + executableExtension));
            }
        }
        AddNonEmpty(outputs, ResolvePath(projectDirectory, Value(instance, "DocumentationFile")));
        foreach (var item in instance.GetItems("UpToDateCheckOutput"))
        {
            AddNonEmpty(outputs, ResolvePath(projectDirectory, item.EvaluatedInclude));
        }
        foreach (var copy in copies)
        {
            AddNonEmpty(outputs, copy.Destination);
        }

        var isSdkStyle = !string.IsNullOrWhiteSpace(Value(instance, "UsingMicrosoftNETSdk"))
            || instance.Items.Any(item => string.Equals(item.ItemType, "ProjectCapability", StringComparison.OrdinalIgnoreCase)
                && string.Equals(item.EvaluatedInclude, ".NET", StringComparison.OrdinalIgnoreCase));
        var opaqueReasons = DetermineOpaqueReasons(instance, isSdkStyle, msbuildPath);
        var references = node.ProjectReferences
            .Select(reference => Path.GetFullPath(reference.ProjectInstance.FullPath))
            .Distinct(PathComparer)
            .OrderBy(value => value, PathComparer)
            .ToArray();
        var id = string.Join("|", projectPath, configuration, platform, targetFramework, runtimeIdentifier);

        return new ProjectVariantModel(
            id,
            projectPath,
            Path.GetFileNameWithoutExtension(projectPath),
            configuration,
            platform,
            targetFramework,
            runtimeIdentifier,
            targetPath,
            referenceAssemblyPath,
            intermediateOutputPath,
            outputPath,
            assetsFile,
            isSdkStyle,
            opaqueReasons.Count > 0,
            opaqueReasons,
            references,
            inputs.OrderBy(value => value, PathComparer).ToArray(),
            imports,
            outputs.OrderBy(value => value, PathComparer).ToArray(),
            copies.OrderBy(copy => copy.Destination, PathComparer).ToArray());
    }

    private static IReadOnlyList<string> LoadImports(
        string projectPath,
        IDictionary<string, string> globalProperties,
        ProjectCollection collection)
    {
        try
        {
            var project = new Project(projectPath, globalProperties, null, collection);
            var imports = project.Imports
                .Select(import => import.ImportedProject.FullPath)
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(Path.GetFullPath)
                .Distinct(PathComparer)
                .OrderBy(value => value, PathComparer)
                .ToArray();
            collection.UnloadProject(project);
            return imports;
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static List<string> DetermineOpaqueReasons(
        ProjectInstance project,
        bool isSdkStyle,
        string msbuildPath)
    {
        var reasons = new List<string>();
        if (!isSdkStyle) reasons.Add("non-sdk-project");
        if (IsTrue(Value(project, "DisableFastUpToDateCheck"))) reasons.Add("fast-up-to-date-disabled");
        if (IsFalse(Value(project, "DotNavSmartBuild"))) reasons.Add("dotnav-smart-build-disabled");
        if (!string.IsNullOrWhiteSpace(Value(project, "PreBuildEvent"))) reasons.Add("pre-build-event");
        if (!string.IsNullOrWhiteSpace(Value(project, "PostBuildEvent"))) reasons.Add("post-build-event");
        if (!string.IsNullOrWhiteSpace(Value(project, "TargetPlatformIdentifier"))) reasons.Add("platform-target");
        if (project.Items.Any(item => string.Equals(item.GetMetadataValue("CopyToOutputDirectory"), "Always", StringComparison.OrdinalIgnoreCase)))
        {
            reasons.Add("copy-always");
        }
        var trustedToolchainRoot = FindTrustedToolchainRoot(msbuildPath);
        var customTargetFiles = project.Targets.Values
            .Select(target => target.Location.File)
            .Where(file => !string.IsNullOrWhiteSpace(file))
            .Select(Path.GetFullPath)
            .Where(file => !IsPathInside(trustedToolchainRoot, file))
            .Select(Path.GetFileName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(file => file, StringComparer.OrdinalIgnoreCase);
        foreach (var file in customTargetFiles) reasons.Add($"custom-target:{file}");
        return reasons;
    }

    private static string FindTrustedToolchainRoot(string msbuildPath)
    {
        var directory = new DirectoryInfo(Path.GetFullPath(msbuildPath));
        while (directory.Parent != null)
        {
            if (string.Equals(directory.Name, "sdk", StringComparison.OrdinalIgnoreCase)) return directory.Parent.FullName;
            directory = directory.Parent;
        }
        return Path.GetFullPath(msbuildPath);
    }

    private static IReadOnlyList<string> DiscoverConfigurationFiles(string projectDirectory)
    {
        var files = new HashSet<string>(PathComparer);
        var directory = new DirectoryInfo(projectDirectory);
        while (directory != null)
        {
            foreach (var name in new[] { "Directory.Packages.props", "NuGet.Config", "NuGet.config", "nuget.config", "global.json" })
            {
                var candidate = Path.Combine(directory.FullName, name);
                if (File.Exists(candidate)) files.Add(Path.GetFullPath(candidate));
            }
            directory = directory.Parent;
        }
        var lockFile = Path.Combine(projectDirectory, "packages.lock.json");
        if (File.Exists(lockFile)) files.Add(Path.GetFullPath(lockFile));
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        foreach (var candidate in new[]
        {
            Path.Combine(userProfile, ".nuget", "NuGet", "NuGet.Config"),
            Path.Combine(userProfile, ".config", "NuGet", "NuGet.Config"),
            Path.Combine(applicationData, "NuGet", "NuGet.Config")
        })
        {
            if (File.Exists(candidate)) files.Add(Path.GetFullPath(candidate));
        }
        return files.OrderBy(value => value, PathComparer).ToArray();
    }

    private static void AddCopy(
        ProjectItemInstance item,
        string projectDirectory,
        string outputPath,
        ICollection<FileCopyModel> copies,
        ISet<string> inputs)
    {
        var mode = item.GetMetadataValue("CopyToOutputDirectory");
        if (string.Equals(mode, "Never", StringComparison.OrdinalIgnoreCase)) return;
        if (string.IsNullOrWhiteSpace(mode) && !string.Equals(item.ItemType, "CopyToOutputDirectoryItem", StringComparison.OrdinalIgnoreCase)
            )
        {
            return;
        }

        var source = ResolvePath(projectDirectory, item.EvaluatedInclude);
        if (string.IsNullOrEmpty(source) || string.IsNullOrEmpty(outputPath)) return;
        var relativeTarget = item.GetMetadataValue("TargetPath");
        if (string.IsNullOrWhiteSpace(relativeTarget)) relativeTarget = item.GetMetadataValue("Link");
        if (string.IsNullOrWhiteSpace(relativeTarget)) relativeTarget = Path.GetFileName(source);
        var destination = ResolvePath(outputPath, relativeTarget);
        inputs.Add(source);
        copies.Add(new FileCopyModel(source, destination, string.IsNullOrWhiteSpace(mode) ? "PreserveNewest" : mode));
    }

    private static void AddNonEmpty(ISet<string> paths, string value)
    {
        if (!string.IsNullOrEmpty(value)) paths.Add(value);
    }

    private static string ResolvePath(string basePath, string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Contains("$(", StringComparison.Ordinal)) return string.Empty;
        if (!OperatingSystem.IsWindows()) value = value.Replace('\\', '/');
        return Path.GetFullPath(Path.IsPathRooted(value) ? value : Path.Combine(basePath, value));
    }

    private static string Value(ProjectInstance project, string name, string fallback = "")
    {
        var value = project.GetPropertyValue(name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private static bool IsTrue(string value) => string.Equals(value, "true", StringComparison.OrdinalIgnoreCase);
    private static bool IsFalse(string value) => string.Equals(value, "false", StringComparison.OrdinalIgnoreCase);
    private static bool IsPathInside(string directory, string candidate)
    {
        var relative = Path.GetRelativePath(directory, candidate);
        return relative.Length > 0 && relative != ".." && !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
            && !Path.IsPathRooted(relative);
    }
    private static StringComparer PathComparer => OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
}
