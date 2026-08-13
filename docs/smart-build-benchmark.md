# Smart Build benchmark

Release-candidate measurement on 2026-08-11, Linux, .NET SDK 6.0.428. The fixture is a generated 200-project dependency chain. Times are wall-clock measurements; Smart warm time includes content hashing and plan creation with a cached graph, while MSBuild warm time invokes `dotnet build` normally.

| Projects | Cold MSBuild | Warm MSBuild | Graph evaluation | Smart warm plan | Warm reduction |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 5,635 ms | 1,829 ms | 1,076 ms | 30 ms | 98.34% |
| 200 | 42,201 ms | 109,640 ms | 4,481 ms | 185 ms | 99.83% |

The 200-project warm MSBuild result is unusually slower than its cold result on this machine, so it should not be treated as a universal MSBuild baseline. The reproducible release gate is that an unchanged Smart Build plan invokes no MSBuild projects and remains well below the normal warm invocation. Run `npm run benchmark:smart-build -- 200` to reproduce it on release hardware.
