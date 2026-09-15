/** Alerts page: placeholder until the alert pipeline is published. */
export class AlertsPage {
  private started = false;
  start(): void {
    if (this.started) return;
    this.started = true;
    // Nothing dynamic yet. When the alerts table is published, load it here and list the contracts with alerts.
  }
}
