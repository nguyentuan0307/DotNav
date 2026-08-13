# DotNav Smart Build Architecture

## Status

Implemented as an opt-in preview controlled by `dotnav.smartBuild.enabled`.
A version-aware What's New picker groups this and other new opt-in features into
one upgrade prompt; leaving it unselected keeps the feature disabled and it can
be enabled later in Settings. The existing `Build`, `Rebuild`, and `Clean`
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

Warm planning first validates cached file size and modification time. Content is
hashed only for files that changed (or when no trustworthy fingerprint exists),
while successful-state capture still hashes every input and output. File creates
and deletes invalidate graph evaluation for SDK/custom globs; unrelated content
edits do not.

Opaque projects fall back individually. Their recursive MSBuild semantics are
retained, but one opaque project no longer discards the up-to-date decisions for
the rest of a solution.

## Build modes

- **Build**: existing standard `dotnet build` behavior.
- **Smart Build**: evaluate freshness and build only proven affected
  projects. Internal planning failures fall back to Build.
- **Shadow**: compute and log a Smart Build plan, then execute standard Build.
  This mode is for validation and is not exposed as a primary command.

## Run, debug, and test integration

`dotnav.buildBeforeRunMode` controls execution safety without changing the two
explicit build commands:

- **Standard** is the default and preserves the normal build-before-run path.
- **Smart** completes a Smart Build before starting any target. A failed,
  cancelled, timed-out, or concurrently modified build prevents Run, Debug, or
  Test from starting. Tests then use `--no-build`; run/debug resolve only the
  verified output.
- **None** intentionally uses existing output and performs no freshness check.

Compound configurations perform one graph-aware pre-build for all selected
projects before creating target processes. This prevents one target from
starting while another target's required dependency build is still failing.

## Observability

Every Smart Build records evaluation, planning, artifact-copy, MSBuild,
state-capture, and total elapsed time together with build/copy counts, cache
presence, and restore status. Explain Plan presents the summary and each
project's decision reasons in a searchable picker while retaining the full
text in the Smart Build output channel.

MSBuild binary logs are opt-in with `dotnav.smartBuild.generateBinaryLog` and
are stored in extension workspace storage unless
`dotnav.smartBuild.binaryLogDirectory` is set. They are diagnostic artifacts,
not cache inputs, and must not affect correctness if removed.

## Release gates

- No false up-to-date result in differential mutation tests.
- Standard Build remains functional when the host or cache is unavailable.
- Warm no-op planning avoids invoking MSBuild for every proven-current project;
  benchmark results are recorded per release candidate rather than hard-coded.
- Cold build regression remains below 5%.
- Run/debug/test never observe a stale referenced implementation assembly.
- Windows, Linux, and macOS fixture suites are required by CI before release.
