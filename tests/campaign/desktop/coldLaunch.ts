/**
 * The campaign uses the production cold-launch harness directly. Keeping one launcher
 * means process-tree cleanup, CDP failure cleanup, and guarded session deletion cannot
 * drift between the regression gate and the longer repeated evidence runs.
 */
export * from '../../e2e/desktop/coldLaunch';
