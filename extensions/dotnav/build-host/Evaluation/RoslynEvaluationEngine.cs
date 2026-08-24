using System.Reflection;
using System.Text.Json.Serialization;

namespace DotNav.BuildHost.Evaluation;

public sealed record LinqChainModel(
    string RootIdentifier,
    string? OrderByProperty,
    bool OrderByDescending,
    string? SelectMethod,
    IReadOnlyList<string> WhereExpressions,
    bool HasPagination,
    int? PageNumber,
    int? PageSize
);

public sealed record RoslynEvaluationResult(
    bool Success,
    string? RoslynVersion,
    LinqChainModel? LinqChain,
    string? TranspiledSqlClause,
    string? ErrorMessage
);

internal sealed class RoslynEvaluationEngine
{
    private readonly string _msBuildPath;
    private Assembly? _csharpAssembly;
    private bool _initialized;
    private string? _initError;

    public RoslynEvaluationEngine(string msBuildPath)
    {
        _msBuildPath = msBuildPath;
    }

    private void EnsureInitialized()
    {
        if (_initialized) return;
        _initialized = true;

        try
        {
            var candidatePaths = new[]
            {
                Path.Combine(_msBuildPath, "Roslyn", "bincore", "Microsoft.CodeAnalysis.CSharp.dll"),
                Path.Combine(_msBuildPath, "Roslyn", "Microsoft.CodeAnalysis.CSharp.dll"),
                Path.Combine(_msBuildPath, "Microsoft.CodeAnalysis.CSharp.dll")
            };

            string? foundPath = null;
            foreach (var path in candidatePaths)
            {
                if (File.Exists(path))
                {
                    foundPath = path;
                    break;
                }
            }

            if (foundPath != null)
            {
                var corePath = Path.Combine(Path.GetDirectoryName(foundPath)!, "Microsoft.CodeAnalysis.dll");
                if (File.Exists(corePath))
                {
                    Assembly.LoadFrom(corePath);
                }
                _csharpAssembly = Assembly.LoadFrom(foundPath);
            }
            else
            {
                _initError = "Microsoft.CodeAnalysis.CSharp.dll was not found in .NET SDK path.";
            }
        }
        catch (Exception ex)
        {
            _initError = ex.Message;
        }
    }

    public RoslynEvaluationResult AnalyzeExpression(string rawExpression)
    {
        EnsureInitialized();

        if (string.IsNullOrWhiteSpace(rawExpression))
        {
            return new RoslynEvaluationResult(false, null, null, null, "Expression was empty.");
        }

        var cleaned = rawExpression.Trim().TrimEnd(';');

        // 1. Extract root variable (e.g. "query" from "query.OrderByDescending(...)")
        var rootMatch = System.Text.RegularExpressions.Regex.Match(cleaned, @"^([a-zA-Z0-9_]+)\s*(?:\.|\z)");
        var rootId = rootMatch.Success ? rootMatch.Groups[1].Value : cleaned;

        // 2. Extract OrderBy / OrderByDescending property
        string? orderProp = null;
        bool isDesc = false;
        var orderMatch = System.Text.RegularExpressions.Regex.Match(
            cleaned,
            @"\.OrderBy(Descending)?\s*\(\s*(?:[a-zA-Z0-9_]+|\(\s*\))\s*=>\s*(?:[a-zA-Z0-9_]+|\(\s*\))\s*\.?\s*([a-zA-Z0-9_]+)\s*\)"
        );
        if (orderMatch.Success)
        {
            isDesc = orderMatch.Groups[1].Value == "Descending";
            orderProp = orderMatch.Groups[2].Value;
        }

        // 3. Extract Select(...) projection
        string? selectExpr = null;
        var selectMatch = System.Text.RegularExpressions.Regex.Match(cleaned, @"\.Select\s*\(([\s\S]+?)\)(?:\s*\.|\s*$)");
        if (selectMatch.Success)
        {
            selectExpr = selectMatch.Groups[1].Value.Trim();
        }

        // 4. Extract Where(...) predicates
        var whereList = new List<string>();
        var whereMatches = System.Text.RegularExpressions.Regex.Matches(cleaned, @"\.Where\s*\(([\s\S]+?)\)");
        foreach (System.Text.RegularExpressions.Match m in whereMatches)
        {
            whereList.Add(m.Groups[1].Value.Trim());
        }

        // 5. Extract pagination (ToPagedListAsync, Take, Skip)
        bool hasPagination = cleaned.Contains("ToPagedList") || cleaned.Contains(".Take(") || cleaned.Contains(".Skip(");
        int? pageNo = null;
        int? pageSize = null;
        var pagedMatch = System.Text.RegularExpressions.Regex.Match(cleaned, @"ToPagedList(?:Async)?\s*\(\s*([^,]+),\s*([^,\)]+)");
        if (pagedMatch.Success)
        {
            if (int.TryParse(pagedMatch.Groups[1].Value.Trim(), out var p)) pageNo = p;
            if (int.TryParse(pagedMatch.Groups[2].Value.Trim(), out var s)) pageSize = s;
        }

        // Build supplementary SQL clauses
        var sqlClauses = new List<string>();
        if (!string.IsNullOrEmpty(orderProp))
        {
            sqlClauses.Add($"ORDER BY [{orderProp}] {(isDesc ? "DESC" : "ASC")}");
        }

        var chainModel = new LinqChainModel(
            rootId,
            orderProp,
            isDesc,
            selectExpr,
            whereList,
            hasPagination,
            pageNo,
            pageSize
        );

        var version = _csharpAssembly?.GetName().Version?.ToString() ?? "SDK-Native";
        var transpiledSql = sqlClauses.Count > 0 ? string.Join("\n", sqlClauses) : null;

        return new RoslynEvaluationResult(
            Success: true,
            RoslynVersion: version,
            LinqChain: chainModel,
            TranspiledSqlClause: transpiledSql,
            ErrorMessage: _initError
        );
    }
}
