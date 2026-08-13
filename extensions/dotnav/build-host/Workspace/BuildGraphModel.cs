namespace DotNav.BuildHost.Workspace;

internal sealed record FileCopyModel(string Source, string Destination, string Mode);

internal sealed record ProjectVariantModel(
    string Id,
    string ProjectPath,
    string ProjectName,
    string Configuration,
    string Platform,
    string TargetFramework,
    string RuntimeIdentifier,
    string TargetPath,
    string ReferenceAssemblyPath,
    string IntermediateOutputPath,
    string OutputPath,
    string AssetsFile,
    bool IsSdkStyle,
    bool IsOpaque,
    IReadOnlyList<string> OpaqueReasons,
    IReadOnlyList<string> ProjectReferences,
    IReadOnlyList<string> Inputs,
    IReadOnlyList<string> Imports,
    IReadOnlyList<string> Outputs,
    IReadOnlyList<FileCopyModel> Copies);

internal sealed record BuildGraphModel(
    int ProtocolVersion,
    string MsbuildPath,
    string MsbuildVersion,
    IReadOnlyDictionary<string, string> GlobalProperties,
    IReadOnlyList<ProjectVariantModel> Projects);
