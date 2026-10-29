-- db/migrations/0002_run_results_unique.sql
CREATE UNIQUE INDEX idx_run_results_run_retailer ON run_results(run_id, retailer_id);
