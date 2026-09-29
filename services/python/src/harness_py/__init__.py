"""Python service/worker skeleton for the harness ML/data plane.

P00 scope: a typed, tested package that consumes the portable contract
schemas exported by the TypeScript control plane (specs/schemas). Python never
imports TypeScript internals; cross-language boundaries use versioned
contracts (MASTER_PROJECT_WORKFLOW.md section 11, ADR-0003).
"""

from harness_py.contracts import SchemaSnapshot, load_schema, required_fields

__all__ = ["SchemaSnapshot", "load_schema", "required_fields"]
__version__ = "0.0.0"
