# DotNav Smart Build Architecture

## Status

Implemented. The existing `Build`, `Rebuild`, and `Clean`
commands keep their current MSBuild semantics. Smart Build is introduced as a
separate command and never replaces the standard path silently.

## Correctness invariants

1. A project is skipped only when DotNav can prove that all evaluated inputs,
   build properties, toolchain identity, dependencies, and required outputs are
   unchanged.
2. Unknown, unsupported, opaque, or corrupt state always falls back to standard
   MSBuild.
3. Failed, cancelled, timed-out, or concurrently modified builds never commit a
   fresh state.
4. `Rebuild` bypasses Smart Build. `Clean` invalidates all related Smart Build
   state.
5. Cache data is advisory and disposable. Removing it must never change build
   correctness.
6. Smart Build never compiles source itself. MSBuild remains the build engine.
7. An unchanged public API may avoid dependent compilation, but updated
   implementation outputs must still be propagated before run, debug, or test.

## Supported scope

The first stable implementation accelerates evaluated SDK-style managed
projects. Unsupported project types remain in the same solution and are built
through the standard path. Support is decided per project/build variant rather
than per solution.

## Components

- `src/build`: VS Code command integration, state, change tracking, planning,
  execution, diagnostics, and fail-safe fallback.
- `build-host`: a small .NET process that evaluates projects with the installed
  MSBuild and returns a versioned JSON model.
- MSBuild: performs restore, compilation, generators, analyzers, custom targets,
  and conservative fallback builds.

## Build modes

- **Build**: existing standard `dotnet build` behavior.
- **Smart Build**: evaluate freshness and build only proven affected
  projects. Internal planning failures fall back to Build.
- **Shadow**: compute and log a Smart Build plan, then execute standard Build.
  This mode is for validation and is not exposed as a primary command.

## Release gates

- No false up-to-date result in differential mutation tests.
- Standard Build remains functional when the host or cache is unavailable.
- Warm no-op planning avoids invoking MSBuild for every proven-current project;
  benchmark results are recorded per release candidate rather than hard-coded.
- Cold build regression remains below 5%.
- Run/debug/test never observe a stale referenced implementation assembly.
- Windows, Linux, and macOS fixture suites are required by CI before release.
