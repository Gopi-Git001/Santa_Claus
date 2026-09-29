# P00 Rust verification image.
#
# The official rust images (slim and full, 1.98.1) ship only rustc, cargo and
# rust-std; rustfmt and clippy are not installed. This image adds exactly those
# two components, for the same pinned toolchain, from the official Rust
# distribution. Network is used only while building this image; all checks then
# run with --network none (see scripts/rust-check.ts).
FROM rust:1.98.1-slim-trixie@sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7

RUN rustup component add --toolchain 1.98.1 rustfmt clippy \
 && rustup component list --installed --toolchain 1.98.1
