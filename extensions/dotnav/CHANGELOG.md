# Changelog

All notable changes to DotNav are documented here.

## Unreleased

## [0.23.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.22.2...dotnav-v0.23.0) (2026-08-22)


### Features

* **dotnav:** support searching error messages from .resx localization and inline C# exceptions ([ed86c96](https://github.com/nguyentuan0307/DotNav/commit/ed86c960e3dfa58c453111d8e9d0f9f3a9d3dbaa))
* **dotnav:** trace CQRS flows connecting commands, handlers, and domain events in search everywhere ([88d0e6f](https://github.com/nguyentuan0307/DotNav/commit/88d0e6f214f17ac2ebdfacd8b474df26c0d9488f))

### Bug Fixes

* **dotnav:** support accent-insensitive Vietnamese error search and auto-refresh disk cache ([c0b8ee0](https://github.com/nguyentuan0307/DotNav/commit/c0b8ee0fdeadb774467d40132907ebee2e842d4e))


## [0.22.2](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.22.1...dotnav-v0.22.2) (2026-08-22)


### Bug Fixes

* **dotnav:** enhance partial controller endpoint detection, fuzzy route search, and comprehensive symbol scanning ([7e70371](https://github.com/nguyentuan0307/DotNav/commit/7e703719ebfc252e2e844616fc727f6921dc956c))
* **dotnav:** support separate Http and Route attributes with custom action decorators ([956ef2c](https://github.com/nguyentuan0307/DotNav/commit/956ef2cd1f44fb25b65afd85f54fc82a5a39ebcf))


## [0.22.1](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.22.0...dotnav-v0.22.1) (2026-08-21)


### Bug Fixes

* **dotnav:** register dotnav.selectOpenedFile command ([b7643aa](https://github.com/nguyentuan0307/DotNav/commit/b7643aa34bdf9f9d1916403f1167f95f4bb461d4))
* **dotnav:** automatically rescan search everywhere on git checkout and workspace changes ([b40f635](https://github.com/nguyentuan0307/DotNav/commit/b40f635de167f74366dbe271995e8eb0862a4648))


## [0.22.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.21.0...dotnav-v0.22.0) (2026-08-19)


### Features

* **dotnav:** implement in-place solution tree filtering and tree view enhancements ([1ab99b4](https://github.com/nguyentuan0307/DotNav/commit/1ab99b4d8c006ca0629e68325ee5c312c3f15532))
* **dotnav:** expand smart C# templates, optimize folder invalidation, and add Alt+Insert shortcut ([ad3c87b](https://github.com/nguyentuan0307/DotNav/commit/ad3c87b26ec02fad12d5913d6d05067c93fb182a))

### Performance Improvements

* **dotnav:** optimize file nesting with O(N) map-based lookup ([0b61375](https://github.com/nguyentuan0307/DotNav/commit/0b61375fcc00431c12539d1fac78d4aa0522ec4d))
* **dotnav:** prevent full tree refreshes on individual project metadata load ([944ca5e](https://github.com/nguyentuan0307/DotNav/commit/944ca5e3652ef228aed5a54f56948ebe5a13afdc))
* **dotnav:** implement hybrid background warm-up for project metadata ([4fa9eb8](https://github.com/nguyentuan0307/DotNav/commit/4fa9eb8b83e9ddcc4a48af40432f7e67878b2f66))


## [0.21.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.20.0...dotnav-v0.21.0) (2026-08-19)


### Features

* **dotnav:** fix symbol search candidate retrieval to include prefix and substring matches ([8638485](https://github.com/nguyentuan0307/DotNav/commit/8638485bc3d128d7492d3dd61275515aeac81b0b))
* **dotnav:** fix search candidate bucketing and sync package contributions ([2769e88](https://github.com/nguyentuan0307/DotNav/commit/2769e88a275db043055434af58788ea4f635921d))


## [0.20.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.19.0...dotnav-v0.20.0) (2026-08-19)


### Features

* **dotnav:** bump to v0.15.0 with full keybindings for Search Everywhere ([a7b73e7](https://github.com/nguyentuan0307/DotNav/commit/a7b73e783adc1297951b820554da32259017c328))
* **dotnav:** release v0.20.0 with Search Everywhere ([0089de1](https://github.com/nguyentuan0307/DotNav/commit/0089de18ee287c5c3729ab2900d88a3689940a02))


## [0.19.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.18.0...dotnav-v0.19.0) (2026-08-19)


### Features

* **dotnav:** implement high-performance Universal Solution Search Everywhere across all 8 enterprise .NET layers ([48c732c](https://github.com/nguyentuan0307/DotNav/commit/48c732cb4cf9b6eea12aef8d250a1c2e170238f9))
* **dotnav:** enhance EF Core DbSet and domain entity recognition heuristics in universal search ([22ef67b](https://github.com/nguyentuan0307/DotNav/commit/22ef67b64501604f3c0845cc930a7b7b54379260))
* **dotnav:** expand universal search coverage to 82,000+ symbols including all method modifiers and entity properties ([f8a2185](https://github.com/nguyentuan0307/DotNav/commit/f8a21856d95fd2dc030937d9655a28c58efac933))
* **dotnav:** implement 4 deep optimizations for universal search (sub-3ms latency, interning, smart ranking, git warming) ([21951f7](https://github.com/nguyentuan0307/DotNav/commit/21951f7de35cba05ff2eee813f84b20b32e6e30b))
* **dotnav:** implement persistent disk cache with SWR sync and live code definition preview ([2c0df5c](https://github.com/nguyentuan0307/DotNav/commit/2c0df5c440750c07da292e572565626cc120877a))
* **dotnav:** implement JetBrains Rider Search Everywhere webview with side-by-side code preview pane ([86cd9e2](https://github.com/nguyentuan0307/DotNav/commit/86cd9e232c88d90e2e7efcda29e6da7d2dbc2c9e))
* **dotnav:** refactor Search Everywhere to 2-row popup modal with draggable resizer divider ([bb6b788](https://github.com/nguyentuan0307/DotNav/commit/bb6b7887b19b2bf11afc2b3f96049168a5ddf4fe))
* **dotnav:** set Search Everywhere to native floating popup with embedded multi-line code preview ([5ab67d9](https://github.com/nguyentuan0307/DotNav/commit/5ab67d9b41bc732dbdaa7543ef7fdca7a48c8f0f))
* **dotnav:** bump to v0.12.0 and add Search Everywhere feature announcement popup on update ([7ad03af](https://github.com/nguyentuan0307/DotNav/commit/7ad03afc54cf69921a590a48c321150f3bfc6850))

### Bug Fixes

* **dotnav:** fix inheritance parsing boundary and acronym case preservation in universal search ([8e304d0](https://github.com/nguyentuan0307/DotNav/commit/8e304d0d93dce9defc964dadc364ec5ae2b594a8))
* **dotnav:** remove search endpoints toolbar icon and distinguish search everywhere icon from solution filter ([9990fd5](https://github.com/nguyentuan0307/DotNav/commit/9990fd584d7f3f002cda5e1afc29f8f1a1dc3d29))
* **dotnav:** route searchEverywhere to Rider 2-row modal and restore focus on dismiss ([4aa27da](https://github.com/nguyentuan0307/DotNav/commit/4aa27daf6ee5732676b341153e7d0cb672215a7f))

### Changes

* refactor(dotnav): restore clean, ultra-fast native QuickPick Search Everywhere without webview tabs ([613c5da](https://github.com/nguyentuan0307/DotNav/commit/613c5daccdf1fbfbebe3d79196c1ebb4a0333c16))


## [0.18.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.17.0...dotnav-v0.18.0) (2026-08-18)


### Features

* **gitnav:** add interactive Git Worktree Status Bar controller with rich tooltip and quick switcher ([4be03cd](https://github.com/nguyentuan0307/DotNav/commit/4be03cd58eefe201f14b0f53168c6ae1bebfff23))

### Bug Fixes

* **dotnav:** ensure full solution scan completion lifecycle before returning endpoint search results ([faee559](https://github.com/nguyentuan0307/DotNav/commit/faee559e15537be410866e23c69a7eb936c90dc1))


## [0.17.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.16.0...dotnav-v0.17.0) (2026-08-18)


### Features

* **dotnav:** add ASP.NET Core endpoint explorer with flexible route search ([e0ad67c](https://github.com/nguyentuan0307/DotNav/commit/e0ad67c86efd94de7000696d10b67ec33e89891d))
* **dotnav:** add cURL command formatting and pure formatter test separation ([a3ebe86](https://github.com/nguyentuan0307/DotNav/commit/a3ebe8638935cd125c38eaf25460f9e4b954dc4a))
* **dotnav:** implement 5-tier ultra-smart ASP.NET Core endpoint search engine ([8dad3de](https://github.com/nguyentuan0307/DotNav/commit/8dad3de221e0acf4745a6e3e9a2ba32a42c2971d))
* **dotnav:** support project-filtered endpoint search and workspace standalone project scanning ([ab6cf18](https://github.com/nguyentuan0307/DotNav/commit/ab6cf18d9fb6d52f3707e60d9e9274ea9ecaca10))
* **dotnav:** contribute default keybindings ctrl+alt+a and alt+shift+a for endpoint search ([bfe85f2](https://github.com/nguyentuan0307/DotNav/commit/bfe85f289e0268664a09cd9075f04601e918667d))
* **dotnav:** add rock-solid incremental cache, background warmup, and keyboard-first actions for endpoint explorer ([195d8cc](https://github.com/nguyentuan0307/DotNav/commit/195d8cc759f88d8cc39417bc7e6f94b833e2b28f))

### Bug Fixes

* **dotnav:** set alwaysShow true on QuickPick search results to prevent VS Code client-side filter suppression ([1c54619](https://github.com/nguyentuan0307/DotNav/commit/1c54619239ea5240e2f667d29b615b3e0f15a2d7))

### Performance Improvements

* **dotnav:** optimize typo matcher with zero-allocation isNearMatch ([10f80f7](https://github.com/nguyentuan0307/DotNav/commit/10f80f75dd4e256e9e167f826de740fbdb33b7f4))

### Changes

* test(dotnav): add tests for api/fields/{fieldId:int}/validation route matching ([bc1e687](https://github.com/nguyentuan0307/DotNav/commit/bc1e6873cc7eaacc30310025ec84eaf3eab747a7))


## [0.16.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.15.0...dotnav-v0.16.0) (2026-08-18)


### Features

* **dotnav:** add smart formatting for collection expressions, switch expressions, and multiline operators ([d7a2008](https://github.com/nguyentuan0307/DotNav/commit/d7a20080684d10732005767cb633dfd485df4a57))


## [0.15.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.14.0...dotnav-v0.15.0) (2026-08-18)


### Features

* **dotnav:** add empty migration generator, visual timeline & connection ping to EF Core Center ([d2bd05f](https://github.com/nguyentuan0307/DotNav/commit/d2bd05f19dedf181cb80f2b55f9fed8fcdad1dd0))


## [0.14.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.13.0...dotnav-v0.14.0) (2026-08-17)


### Features

* **dotnav:** optimize build and debug with zero-config startup, 1-click process attach, and build diagnostics ([4837e78](https://github.com/nguyentuan0307/DotNav/commit/4837e78e8d94de43e872d68f7837ff32cc14b5b2))

### Bug Fixes

* **ci:** fix cross-platform path handling in processDiscovery and test suite on Linux/macOS ([f45f054](https://github.com/nguyentuan0307/DotNav/commit/f45f054a94ea617e629580e08ece7d380b9e81ec))

### Performance Improvements

* **dotnav:** optimize smart build with pre-warming, fast-path check, and targeted scoping ([29f5513](https://github.com/nguyentuan0307/DotNav/commit/29f5513cd016f6963698af7257fc6468c3d14e47))
* **dotnav:** optimize standard MSBuild with parallel multi-core flags and streamline build commands ([86e734d](https://github.com/nguyentuan0307/DotNav/commit/86e734d1de5ba637bcf86833736e8c851d2e6d8b))
* **dotnav:** add smart --no-restore auto-fallback and MSBuild acceleration flags with full .NET 6.0+ backward compatibility ([c6ee106](https://github.com/nguyentuan0307/DotNav/commit/c6ee106317cb831d9027ccf2635e1475a5636756))


## [0.13.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.12.0...dotnav-v0.13.0) (2026-08-13)


### Features

* **dotnav:** add correctness-first smart build ([f745201](https://github.com/nguyentuan0307/DotNav/commit/f745201196ea26095bc1a9e370d379711a6aebcc))
* **dotnav:** complete smart build rollout phases ([fdb6c5b](https://github.com/nguyentuan0307/DotNav/commit/fdb6c5b9cb1b741fb118b673aba901c8e2149fd1))
* **dotnav:** ship opt-in smart build preview ([af6c64a](https://github.com/nguyentuan0307/DotNav/commit/af6c64ae1a426549cffd628cdfa06a8bd7096f08))

### Bug Fixes

* **dotnav:** isolate smart build host requests ([4a89d1b](https://github.com/nguyentuan0307/DotNav/commit/4a89d1b1f4ec477672cdc3610c6009e41478b269))
* **ci:** use a compatible MSBuild SDK ([878118b](https://github.com/nguyentuan0307/DotNav/commit/878118b93e77f2158b3b8fd48e91d7f7f533f9ef))
* **ci:** serialize DotNav integration tests ([77bb1d5](https://github.com/nguyentuan0307/DotNav/commit/77bb1d519bed34ae00de97b6944bc4bbe77e68c5))
* **dotnav:** await Build Host shutdown ([0655cf4](https://github.com/nguyentuan0307/DotNav/commit/0655cf47ddc0a0861538638b0f9d2e92b59483bf))
* **dotnav:** wait for Build Host streams to close ([f0926a9](https://github.com/nguyentuan0307/DotNav/commit/f0926a9e654ec75c673caa00ccf005badcafb379))

### Performance Improvements

* **dotnav:** refine smart build dependencies ([5fd5376](https://github.com/nguyentuan0307/DotNav/commit/5fd53767315d096ed5feb4f8d3b37ae04aced281))

### Changes

* test(dotnav): retry Windows Build Host cleanup ([7445f4c](https://github.com/nguyentuan0307/DotNav/commit/7445f4c31e561a6d2b582a9377bd7760a4ab9312))
* test(dotnav): allow Windows Build Host cleanup lag ([c06dacb](https://github.com/nguyentuan0307/DotNav/commit/c06dacb0dfc94a9abdcbae9d5cbf07132604e91f))


## [0.12.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.11.0...dotnav-v0.12.0) (2026-08-11)


### Features

* **dotnav:** add opt-in local history ([a8092b0](https://github.com/nguyentuan0307/DotNav/commit/a8092b0b024aab33116a17b39441fba82a1b6e6d))

### Bug Fixes

* **dotnav:** keep EF Core Center actions reusable ([7ae91a6](https://github.com/nguyentuan0307/DotNav/commit/7ae91a6af1ecf022110c0d47ae38af6cfa980c0e))


## [0.11.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.10.0...dotnav-v0.11.0) (2026-07-31)


### Features

* **dotnav:** edit compound projects ([61a8830](https://github.com/nguyentuan0307/DotNav/commit/61a8830d74cd0b8594c108c062948faac74f16c8))

### Performance Improvements

* **dotnav:** narrow workspace refreshes ([14b11a3](https://github.com/nguyentuan0307/DotNav/commit/14b11a3096f458082385ca977576fd2b778198ec))

### Changes

* refactor(dotnav): modularize EF center ([e36dc7e](https://github.com/nguyentuan0307/DotNav/commit/e36dc7e91964b51c25f9d0142d23c1056e729307))
* docs: add project state tooling ([c0f63bd](https://github.com/nguyentuan0307/DotNav/commit/c0f63bd933c7934009ed9da58662045425082db0))


## [0.10.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.9.0...dotnav-v0.10.0) (2026-07-30)


### Features

* **dotnav:** add structure-aware reformatting ([e7995b6](https://github.com/nguyentuan0307/DotNav/commit/e7995b6aaf23e081cef906e50648350fff85aa0a))

### Changes

* chore: merge release into master ([bb5b6a8](https://github.com/nguyentuan0307/DotNav/commit/bb5b6a85f770e543930a9f4af590b180e85b4511))


## [0.9.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.8.2...dotnav-v0.9.0) (2026-07-27)


### Features

* **dotnav:** move EF Core tools to a Rider-style context menu and dialog ([6d67ee3](https://github.com/nguyentuan0307/DotNav/commit/6d67ee37ea4584a9f22ce3597ef36f53eaab0d2b))
* **dotnav:** complete EF Core Center ([227112a](https://github.com/nguyentuan0307/DotNav/commit/227112a65331e293fd4a679f5a6ee72081332e0f))

### Bug Fixes

* **dotnav:** always show the EF Core view instead of hiding it ([362e8da](https://github.com/nguyentuan0307/DotNav/commit/362e8da3b330dc2a19d3406b294a678c63f2e0ca))
* **dotnav:** expand the EF Core view by default ([d4b238e](https://github.com/nguyentuan0307/DotNav/commit/d4b238e06f7252d5f099a43f91c5bd6c060b2868))
* **dotnav:** make EF dialogs searchable and readable ([79919b0](https://github.com/nguyentuan0307/DotNav/commit/79919b0787514216a9f618d224e3ec60180d4e46))
* **dotnav:** repair EF dialog behaviour and layout ([20e2122](https://github.com/nguyentuan0307/DotNav/commit/20e21226afeeb6e4a3f8add20758608d6f48f7ae))
* **dotnav:** keep EF dialog autofocus out of the collapsed section ([1700b89](https://github.com/nguyentuan0307/DotNav/commit/1700b89203febe4e8faf2cda25973e168ee7919d))

### Changes

* test(dotnav): cover EF Core workflows ([03cd012](https://github.com/nguyentuan0307/DotNav/commit/03cd012d20fc1fce7a37a2c19f3412f5582cc41d))
* Merge branch 'release' ([641d01a](https://github.com/nguyentuan0307/DotNav/commit/641d01a016310872476944dde7f106ca7b240a41))

## [0.8.2](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.8.1...dotnav-v0.8.2) (2026-07-24)


### Bug Fixes

* **dotnav:** broaden EF project detection ([9ceadca](https://github.com/nguyentuan0307/DotNav/commit/9ceadca9e2578f7761ba72207e03429c923d4c41))

### Changes

* Merge remote-tracking branch 'origin/master' into release-candidate ([eb2f292](https://github.com/nguyentuan0307/DotNav/commit/eb2f292c582bb351653e80b6cbfbe2243ec34d21))


## [0.8.1](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.8.0...dotnav-v0.8.1) (2026-07-24)


### Bug Fixes

* **dotnav:** document EF Core tools in README ([93b5979](https://github.com/nguyentuan0307/DotNav/commit/93b5979bb9eebafaacefbc5b4be059fbd851624a))

### Changes

* Merge remote-tracking branch 'origin/master' into release-candidate ([3c18c39](https://github.com/nguyentuan0307/DotNav/commit/3c18c39f97e5cdc2bfef45d2ef7722fa903b85c5))


## [0.8.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.7.0...dotnav-v0.8.0) (2026-07-24)


### Features

* build folder projects in one parallel MSBuild session with a configurable worker limit
* replace per-action EF webviews with one responsive, project-aware EF Core Center
* redesign EF Core Center as a polished, accessible developer cockpit with responsive navigation and command previews
* add pending-model checks, migration bundles, compiled-model optimization, and EF Core 6–11 capability gating
* add on-demand English and Vietnamese guide drawers for every EF Core action, including field examples, prerequisites, expected results, and safety notes
* add a persistent English/Vietnamese language switch to EF Core Center
* show event-driven, bilingual operation progress for every executed EF Core action

### Bug Fixes

* cascade EF project, startup project, DbContext, and migration selections without stale async updates
* keep EF connection overrides transient and require database identity before Drop Database
* detect EF packages when self-closing and paired PackageReference elements are mixed in one project file
* parse quoted additional EF arguments and reject options already managed by DotNav
  
* **dotnav:** add EF Core tools (migrations, database ops, tree view) ([2152c94](https://github.com/nguyentuan0307/DotNav/commit/2152c949ba7c24a1e58deb990085ffaa316ffe9a))

### Changes

* Merge remote-tracking branch 'origin/master' into release-candidate ([fa413ad](https://github.com/nguyentuan0307/DotNav/commit/fa413adf9338f5fdae4038a20f67908377a58512))


## [0.7.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.6.0...dotnav-v0.7.0) (2026-07-19)


### Features

* **dotnav:** manage project references in tree ([8bf26cf](https://github.com/nguyentuan0307/DotNav/commit/8bf26cff70d85a389c713fd905f87ad09383a23a))

### Changes

* Merge remote-tracking branch 'origin/master' into release-candidate ([97e487f](https://github.com/nguyentuan0307/DotNav/commit/97e487f682f615482c4081df146e7fdc7300ac9e))


## [0.6.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.5.1...dotnav-v0.6.0) (2026-07-18)


### Features

* **dotnav:** manage NuGet packages in tree ([30a19ad](https://github.com/nguyentuan0307/DotNav/commit/30a19ad02254a99164b14b4abed07b6165a1c241))

### Bug Fixes

* **dotnav:** avoid NuGet HTTP parser failure ([f9a237d](https://github.com/nguyentuan0307/DotNav/commit/f9a237dfd0373229a3fd5b529f9eda5c064498ac))

### Changes

* Merge remote-tracking branch 'origin/master' into release-candidate ([c136b7e](https://github.com/nguyentuan0307/DotNav/commit/c136b7eb9712412f8bac1c9c896ce7f3760e1bb1))


## [0.5.1](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.5.0...dotnav-v0.5.1) (2026-07-17)


### Bug Fixes

* **dotnav:** stop scroll-jump on file click, support multi-select file ops ([567c9f8](https://github.com/nguyentuan0307/DotNav/commit/567c9f8ee6441b00b9342d658aabc5dc31b71f6d))

### Changes

* Merge remote-tracking branch 'origin/master' into release-candidate ([7e7dc5f](https://github.com/nguyentuan0307/DotNav/commit/7e7dc5fa96671d3b070432cd871b0723832fe936))


## [0.5.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.4.0...dotnav-v0.5.0) (2026-07-17)


### Features

* **dotnav:** streamline project context actions ([b4140ff](https://github.com/nguyentuan0307/DotNav/commit/b4140fffb1d509ab5571545920235df937d57534))

### Performance Improvements

* **dotnav:** lazy load project metadata ([0eecf58](https://github.com/nguyentuan0307/DotNav/commit/0eecf58dfb4c2004902616de99a814f86fb1ab36))


## [0.4.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.3.2...dotnav-v0.4.0) (2026-07-15)


### Features

* **dotnav:** parallelize folder builds ([51eb1d8](https://github.com/nguyentuan0307/DotNav/commit/51eb1d8362d9bf35af95cb1b826e543e46e4d98c))

## [0.3.2](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.3.1...dotnav-v0.3.2) (2026-07-15)


### Bug Fixes

* publish refreshed DotNav and GitNav icons ([0ba630a](https://github.com/nguyentuan0307/DotNav/commit/0ba630a5d0add533f584e4b2b96d26d35d4c6798))

## [0.3.1](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.3.0...dotnav-v0.3.1) (2026-07-13)


### Bug Fixes

* **release:** use unique GitNav extension ID ([af44e54](https://github.com/nguyentuan0307/DotNav/commit/af44e54f78059e4ebd910f70ad774b9a7285844c))

## [0.3.0](https://github.com/nguyentuan0307/DotNav/compare/dotnav-v0.2.0...dotnav-v0.3.0) (2026-07-13)


### Features

* split GitNav into standalone extension ([10f0ae7](https://github.com/nguyentuan0307/DotNav/commit/10f0ae716feb6fbf4dd687548c6656577aaac4fd))

## [0.2.0](https://github.com/nguyentuan0307/DotNav/compare/v0.1.0...v0.2.0) (2026-07-13)

### Features

* rebrand extension as DotNav ([b6eba94](https://github.com/nguyentuan0307/DotNav/commit/b6eba94dcc6f46e035c8f1721cc368b4fa91659d))

## [0.1.0](https://github.com/nguyentuan0307/DotNav/compare/v0.0.1...v0.1.0) (2026-07-13)


### Features

* add Git conflict and revision workflows ([375b62a](https://github.com/nguyentuan0307/DotNav/commit/375b62affb26374abbce614e93476932021ba8d7))
* add read-only Git Log panel ([f45a8d8](https://github.com/nguyentuan0307/DotNav/commit/f45a8d8b7cabeef8241a2efe6b460004322479db))
* add safe Git Log operations ([8c8f19e](https://github.com/nguyentuan0307/DotNav/commit/8c8f19e7ceb2b37d5029434ff8811d846f71f5ae))
* add smart C# list wrapping ([f60915d](https://github.com/nguyentuan0307/DotNav/commit/f60915dfbdccf0ef1353ab73e9774be8c6f5e6f8))
* add solution build workflows ([62c142c](https://github.com/nguyentuan0307/DotNav/commit/62c142ca94465df0fa867be0bdb3bbed927f946a))
* add solution tree search ([7eea498](https://github.com/nguyentuan0307/DotNav/commit/7eea49848c1e21877c5d3c89025d4d34f8b5ff47))
* build all projects under selected folder ([fc77c8d](https://github.com/nguyentuan0307/DotNav/commit/fc77c8dc4cfba70160b83cdb754e71f8785b1746))
* complete Git branch tree navigation ([9e2706c](https://github.com/nguyentuan0307/DotNav/commit/9e2706ca2a45adb4b0c858f793506ef83c56bacd))
* complete Git changed file workflows ([c75a718](https://github.com/nguyentuan0307/DotNav/commit/c75a718c91e425d54ebd31d224f4c74bee4f5fd0))
* docker tree ([b630dbe](https://github.com/nguyentuan0307/DotNav/commit/b630dbeb02101680e42597d8a1c76448cf35a517))
* enhance Git Log workflows and layout ([452ea13](https://github.com/nguyentuan0307/DotNav/commit/452ea1377f0e51397a41cedaf7295c6f21cb02e2))
* expand Git branch and commit actions ([45096a6](https://github.com/nguyentuan0307/DotNav/commit/45096a675a36a73db479f2dfadb10989844f267b))
* finish Git comparison and revision tools ([572747a](https://github.com/nguyentuan0307/DotNav/commit/572747afbace921d0a08983ed20344c19a50e1a3))
* format a C# selection to house style ([ac3baa8](https://github.com/nguyentuan0307/DotNav/commit/ac3baa8844d51f2f901ea82d9fdc08451c6f56f6))
* harden Git conflict operation workflow ([fada93e](https://github.com/nguyentuan0307/DotNav/commit/fada93e54078430f260036b274f95ba637a7b7e8))
* improve Git Log selection and busy feedback ([dc58acf](https://github.com/nguyentuan0307/DotNav/commit/dc58acf6729a576063d03e9560730563f6adacaf))
* improve Git Log workflows ([e7c8cf1](https://github.com/nguyentuan0307/DotNav/commit/e7c8cf18bdd204a827222940aa7e08309638cd41))
* manage run configuration lifecycle ([1ca583d](https://github.com/nguyentuan0307/DotNav/commit/1ca583dcaf81c1a56e20f1bae1f1187b697966b2))
* redesign Git Log visual hierarchy ([04abc17](https://github.com/nguyentuan0307/DotNav/commit/04abc17a81202d9ebba0f2845670bb9189685877))
* render real Git graph lanes ([75250fb](https://github.com/nguyentuan0307/DotNav/commit/75250fbb4fec288479e9dcda3fc53f13dba71602))
* **search:** filter solution tree in place ([d74caa3](https://github.com/nguyentuan0307/DotNav/commit/d74caa3b9ac4b4bc1c514588fb20f93c30a2630c))
* show git line history for an editor selection ([39062bb](https://github.com/nguyentuan0307/DotNav/commit/39062bb2e68a4ad4b1cc8746c3847b73b75f4c15))
* solution navigator UX, run configs, stability fixes ([6c5bcc3](https://github.com/nguyentuan0307/DotNav/commit/6c5bcc3a7a13f4ffaa939c89c6aee4659e81e7a2))
* **ui:** streamline solution explorer ([2dc029f](https://github.com/nguyentuan0307/DotNav/commit/2dc029fde5c5724570bab53d186cda7ba6fc7782))


### Bug Fixes

* add empty cherry-pick recovery UX ([658c425](https://github.com/nguyentuan0307/DotNav/commit/658c4256f33f09a85b72d708c8dc7f239b9e9a46))
* align multiline C# arguments ([f0f69a0](https://github.com/nguyentuan0307/DotNav/commit/f0f69a0464e2a58d4ba4896ef125bccc5e77a528))
* align two-line fluent chains ([b968bb3](https://github.com/nguyentuan0307/DotNav/commit/b968bb3a5f6805789d8ec96f11de9bccef444dfb))
* allow formatting without editorconfig ([436758a](https://github.com/nguyentuan0307/DotNav/commit/436758a28e53d90f59a95ae15d8abe4ca717de6b))
* build projects from solution folders ([1ad17a7](https://github.com/nguyentuan0307/DotNav/commit/1ad17a76fdffded114db883f8fcd29adfd8d81f6))
* escape rendered Git Log script regex ([15426c0](https://github.com/nguyentuan0307/DotNav/commit/15426c010e275fdea90bd0eff7552f2435fee4c0))
* format strict selection fragments safely ([1dab400](https://github.com/nguyentuan0307/DotNav/commit/1dab4002bc35268b61b94b11b061bc4859a2ee41))
* harden C# formatting edge cases ([60d80c3](https://github.com/nguyentuan0307/DotNav/commit/60d80c39f43844777ca7d3093143caf0ed3770c4))
* harden Git checkout safety flows ([75558fd](https://github.com/nguyentuan0307/DotNav/commit/75558fd381cf0ab6e9c9d4430ab0a839fe8bd045))
* harden Git Log context actions ([9148dcb](https://github.com/nguyentuan0307/DotNav/commit/9148dcb035ea6d689f02984d9c07580e3a27f4ba))
* harden run lifecycle races ([9babe96](https://github.com/nguyentuan0307/DotNav/commit/9babe96f3a236626e63afdc77dc5f1289c0fc36e))
* highlight viewed Git Log branch ([4b7e48f](https://github.com/nguyentuan0307/DotNav/commit/4b7e48f7716d04df266b3a9e25d3ecab3cc2e142))
* keep select opened file in toolbar ([c823d43](https://github.com/nguyentuan0307/DotNav/commit/c823d43a2eaf116aae8bc124a136a22429dca1e0))
* polish Git Log panel interactions ([551d1df](https://github.com/nguyentuan0307/DotNav/commit/551d1dffbc5ac9ae1c5207e86b0349bcfd0cf7fe))
* receive Git Log initialization message ([2dfa20c](https://github.com/nguyentuan0307/DotNav/commit/2dfa20ccdebd4068f3b9d9c9eed23c60575e6dee))
* recover Git Log persisted webview state ([75d5337](https://github.com/nguyentuan0307/DotNav/commit/75d5337a3530f48c38e0ed25de58ef4a1d0bad98))
* render Git history with SVG lanes ([2d4c212](https://github.com/nguyentuan0307/DotNav/commit/2d4c2124d14f6ef5d5a21b6c91ae64244435073b))
* resolve MSBuild backslash paths on POSIX ([8a7b0cd](https://github.com/nguyentuan0307/DotNav/commit/8a7b0cdbc58173e7ad6cf7f968cd0721185395fe))
* respect selection and indentation anchors ([f0cd003](https://github.com/nguyentuan0307/DotNav/commit/f0cd0036ff22517f8c5d8a70438944af0d82c50b))
* **search:** open picker before indexing ([3885cac](https://github.com/nguyentuan0307/DotNav/commit/3885cac18e5b25e75ad87e14642f17bad48d2492))
* **search:** use native tree find control ([7057b41](https://github.com/nguyentuan0307/DotNav/commit/7057b41817cf6825943f0932f63f9344cfbe1563))
* serialize Git Log initialization refresh ([a40299d](https://github.com/nguyentuan0307/DotNav/commit/a40299da38c51cb3db4923cb409b86c8f5eb7f20))
* settle Git mutation busy state reliably ([262dda8](https://github.com/nguyentuan0307/DotNav/commit/262dda83ddfd462cb0e435a9b79912dcc8ff903d))
* **ui:** force native folder codicon ([e8ce2c9](https://github.com/nguyentuan0307/DotNav/commit/e8ce2c94a2ecb2e3dc28f8f13e51a0f03c24c3e3))
* **ui:** restore default folder icons ([d9663c5](https://github.com/nguyentuan0307/DotNav/commit/d9663c50bde478a082974cf8c4765ffc5050ff74))


### Performance Improvements

* cache Git Log reads and sync external changes ([9bf8b99](https://github.com/nguyentuan0307/DotNav/commit/9bf8b9948ee87cffa3e8d76a2cda003b4f855c83))
* harden Git Log navigation ([98e409e](https://github.com/nguyentuan0307/DotNav/commit/98e409e93adb8e042f5967f5c765373dddc9e90b))

## 0.0.1

- Initial Marketplace release.
- Rider-inspired .NET solution and project navigation.
- Build, rebuild, clean, run, debug, and test commands.
- Run configurations and compound configurations.
- Git line history and branch comparison tools.
- C# selection formatting and file nesting support.
