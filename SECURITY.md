# Security

Looper is a local, single-user music tool. Its desktop renderer is sandboxed; privileged file access and rendering go through a restricted application bridge. Optional Python environments, model folders, external analysis projects and FFmpeg installations are trusted code chosen by the user.

Use trusted local runtimes and model sources. Generated reports can include local audio/model paths and prompts; review them before sharing. Local models and audio are not bundled with the source.

To report a vulnerability, use [GitHub private vulnerability reporting](https://github.com/sabcodes/Looper/security/advisories/new). If that feature is unavailable, open an issue asking for a private contact method without including exploit details, credentials or private files.

For a public source release, select only the application source, tests, preset data and documentation. Exclude private notes, Git history from the development repo, generated audio/reports, models, environments, caches and prebuilt app bundles. Do not make the private development repository public as a substitute for a clean source release.
