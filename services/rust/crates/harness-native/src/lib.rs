//! Rust native/runtime skeleton for the harness security/performance plane.
//!
//! P00 scope: a dependency-free, `unsafe`-free crate that proves the Rust
//! toolchain, formatting, lint and test gates. Process supervision, sandboxing
//! and resource enforcement belong to later phases (P07). Cross-language
//! boundaries use versioned contracts, never shared internals (ADR-0003).

/// Kinds of opaque identifiers shared with the TypeScript contracts
/// (`packages/contracts/src/ids.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpaqueIdKind {
    /// Run identifier (`run_`).
    Run,
    /// Thread identifier (`thr_`).
    Thread,
    /// Agent identifier (`agt_`).
    Agent,
    /// Task identifier (`tsk_`).
    Task,
    /// Event identifier (`evt_`).
    Event,
    /// Artifact identifier (`art_`).
    Artifact,
    /// Approval identifier (`apr_`).
    Approval,
    /// Evidence identifier (`evd_`).
    Evidence,
}

impl OpaqueIdKind {
    /// The textual prefix used by this ID kind.
    #[must_use]
    pub const fn prefix(self) -> &'static str {
        match self {
            Self::Run => "run",
            Self::Thread => "thr",
            Self::Agent => "agt",
            Self::Task => "tsk",
            Self::Event => "evt",
            Self::Artifact => "art",
            Self::Approval => "apr",
            Self::Evidence => "evd",
        }
    }
}

const BODY_LEN: usize = 26;

fn is_crockford_lower(c: u8) -> bool {
    matches!(c, b'0'..=b'9' | b'a'..=b'h' | b'j' | b'k' | b'm' | b'n' | b'p'..=b't' | b'v'..=b'z')
}

/// Validate an opaque ID exactly as the TypeScript contract does:
/// `<prefix>_<26 lowercase Crockford base32 chars>`.
#[must_use]
pub fn is_valid_opaque_id(kind: OpaqueIdKind, id: &str) -> bool {
    let Some(body) = id
        .strip_prefix(kind.prefix())
        .and_then(|rest| rest.strip_prefix('_'))
    else {
        return false;
    };
    body.len() == BODY_LEN && body.bytes().all(is_crockford_lower)
}

#[cfg(test)]
mod tests {
    use super::{OpaqueIdKind, is_valid_opaque_id};

    #[test]
    fn accepts_a_valid_id() {
        assert!(is_valid_opaque_id(
            OpaqueIdKind::Run,
            "run_0123456789abcdefghjkmnpqrs"
        ));
    }

    #[test]
    fn rejects_wrong_kind_length_and_alphabet() {
        assert!(!is_valid_opaque_id(
            OpaqueIdKind::Thread,
            "run_0123456789abcdefghjkmnpqrs"
        ));
        assert!(!is_valid_opaque_id(OpaqueIdKind::Run, "run_short"));
        assert!(!is_valid_opaque_id(
            OpaqueIdKind::Run,
            "run_0123456789abcdefghjkmnpqri"
        ));
        assert!(!is_valid_opaque_id(
            OpaqueIdKind::Run,
            "RUN_0123456789abcdefghjkmnpqrs"
        ));
        assert!(!is_valid_opaque_id(
            OpaqueIdKind::Run,
            "run0123456789abcdefghjkmnpqrst"
        ));
    }

    #[test]
    fn prefixes_are_unique() {
        let kinds = [
            OpaqueIdKind::Run,
            OpaqueIdKind::Thread,
            OpaqueIdKind::Agent,
            OpaqueIdKind::Task,
            OpaqueIdKind::Event,
            OpaqueIdKind::Artifact,
            OpaqueIdKind::Approval,
            OpaqueIdKind::Evidence,
        ];
        let mut prefixes: Vec<_> = kinds.iter().map(|k| k.prefix()).collect();
        prefixes.sort_unstable();
        prefixes.dedup();
        assert_eq!(prefixes.len(), kinds.len());
    }
}
