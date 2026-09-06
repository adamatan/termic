//! Test-only seams shared across modules.
//!
//! `TERMIC_DATA_DIR` is PROCESS-wide and cargo runs tests in threads, so every
//! test that redirects it (or reads a path derived from it) has to take the
//! SAME lock. Two modules each holding their own mutex serialize against
//! themselves and race each other, which is the bug this module exists to make
//! impossible: there is one lock, here, and `docker.rs` delegates to it.

/// Serializes every test that redirects `TERMIC_DATA_DIR` or reads something
/// derived from it.
pub(crate) static DATA_DIR_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Point [`crate::global_dir`] at a scratch tree for the duration of `f`.
///
/// Without this a test resolves to the DEVELOPER'S REAL data dir and quietly
/// creates folders in `~/Library/Application Support/termic`. Debug-only seam,
/// the same one `automation.rs` uses.
///
/// The tempdir is passed to `f` so a test can assert against the tree directly
/// rather than re-deriving the path.
pub(crate) fn with_scratch_data_dir<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
    let dir = tempfile::tempdir().unwrap();
    // LOCK FIRST, then read what we are replacing.
    //
    // Reading `prev` before taking the lock meant capturing whatever ANOTHER
    // test had set while it held it. On exit this restored that value: a
    // scratch directory belonging to a test that had already finished and
    // deleted it. Every later test then resolved into a path that no longer
    // existed, which is why the suite failed roughly one run in four, in a
    // different test each time and never in isolation.
    //
    // SAFETY: every test that touches this var takes DATA_DIR_LOCK above.
    let _g = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = std::env::var("TERMIC_DATA_DIR").ok();
    unsafe { std::env::set_var("TERMIC_DATA_DIR", dir.path()) };
    let out = f(dir.path());
    match prev {
        Some(v) => unsafe { std::env::set_var("TERMIC_DATA_DIR", v) },
        None => unsafe { std::env::remove_var("TERMIC_DATA_DIR") },
    }
    out
}
