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

    fn kind_for(prefix: &str) -> OpaqueIdKind {
        match prefix {
            "run" => OpaqueIdKind::Run,
            "thr" => OpaqueIdKind::Thread,
            "agt" => OpaqueIdKind::Agent,
            "tsk" => OpaqueIdKind::Task,
            "evt" => OpaqueIdKind::Event,
            "art" => OpaqueIdKind::Artifact,
            "apr" => OpaqueIdKind::Approval,
            "evd" => OpaqueIdKind::Evidence,
            other => panic!("unknown prefix in fixture: {other}"),
        }
    }

    /// Cross-language conformance: the same fixture is asserted by the TypeScript
    /// contracts (`packages/contracts/test/id-fixture.test.ts`). The path comes from
    /// `HARNESS_ID_FIXTURES` (set by `scripts/rust-check.ts`); a missing fixture fails.
    #[test]
    fn agrees_with_the_shared_typescript_fixture() {
        let path = std::env::var("HARNESS_ID_FIXTURES")
            .expect("HARNESS_ID_FIXTURES must point at specs/fixtures/opaque-ids.txt");
        let text = std::fs::read_to_string(&path).expect("fixture readable");
        let mut checked = 0;
        for line in text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
        {
            let parts: Vec<&str> = line.split_whitespace().collect();
            assert_eq!(parts.len(), 3, "malformed fixture line: {line}");
            let expected = parts[0] == "valid";
            assert_eq!(
                is_valid_opaque_id(kind_for(parts[1]), parts[2]),
                expected,
                "{line}"
            );
            checked += 1;
        }
        assert!(checked > 15, "fixture unexpectedly small ({checked} cases)");
    }

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
