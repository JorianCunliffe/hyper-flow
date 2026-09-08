# PptxGenJS runtime distribution

This private runtime package contains the unchanged MIT-licensed ESM distribution and types from PptxGenJS 4.0.1. See PROVENANCE.json for hashes and LICENSE for attribution. This is a maintained vendored dependency, not a patched upstream release.

Upstream declares image-size even though the distributed ESM runtime does not import or embed it. That unused dependency has unpatched denial-of-service advisories. The runtime manifest excludes it entirely, along with the unused https shim and development-only Node types; jszip remains a normal audited dependency. Node filesystem/HTTPS builtins are imported by upstream for optional file/image paths. HyperFlow supplies only validated embedded PNGs, never remote paths.

Updates: obtain the upstream npm tarball, compare imports and source, retain its license, record exact hashes, then run the Office package/brand tests and render fixtures. Do not add image-size back or suppress CI audit findings. The full vendored source must be reviewed independently of npm audit because registry advisories do not track this private package name.
