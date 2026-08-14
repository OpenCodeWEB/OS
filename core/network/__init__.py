"""OpenCodeWEB OS — Network Layer.

Facade over the dynamic Cloudflare/GitHub edge connector. The single source
of truth for provisioning logic lives in ``core/roadmap/dynamic_edge_provisioner.py``;
this package re-exports the public API and adds a convenience ``EdgeMonitor``
combining load monitoring with a background provisioning loop.

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code.

Maintainers: ABsUP & ABsUPs
"""
