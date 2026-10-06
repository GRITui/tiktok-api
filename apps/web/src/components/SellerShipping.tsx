import React, { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api';
import type { ShipResult } from '@oms/core/types';

interface Provider {
  id: string;
  name: string;
}

interface SellerShipDialogProps {
  packageId: string;
  /** "ship": first shipment (#34). "edit": correct tracking after shipping (#61). */
  mode: 'ship' | 'edit';
  currentTrackingNumber?: string | null;
  onClose: () => void;
  onDone: (result: ShipResult) => void;
}

/** Ship a seller-shipping package with your own carrier, or correct its tracking afterwards. */
export function SellerShipDialog({ packageId, mode, currentTrackingNumber, onClose, onDone }: SellerShipDialogProps) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerId, setProviderId] = useState('');
  const [tracking, setTracking] = useState(mode === 'edit' ? currentTrackingNumber ?? '' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShipResult | null>(null);
  // One key per dialog: a double click or retry after a network error can't ship twice.
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    apiGet<Provider[]>(`/v1/packages/${packageId}/shipping-providers`)
      .then((list) => {
        setProviders(list);
        if (list.length === 1) setProviderId(list[0]!.id);
      })
      .catch((err) => setError(err.message || 'Failed to load carriers'));
  }, [packageId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { shippingProviderId: providerId, trackingNumber: tracking };
      const headers = { headers: { 'Idempotency-Key': idempotencyKey.current } };
      const res =
        mode === 'ship'
          ? await apiPost<ShipResult>(`/v1/packages/${packageId}/ship-seller`, body, headers)
          : await apiPut<ShipResult>(`/v1/packages/${packageId}/tracking`, body, headers);
      setResult(res);
      onDone(res);
    } catch (err: any) {
      // A rejected attempt may be retried with corrected input under a fresh key.
      idempotencyKey.current = crypto.randomUUID();
      const code = err.details?.ttsCode ? ` (TikTok ${err.details.ttsCode})` : '';
      setError((err.message || 'Request failed') + code);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'ship' ? 'Ship with own carrier' : 'Edit tracking';
  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Package {packageId}</div>
        {result ? (
          <>
            <div className="banner success" role="status">
              {mode === 'ship' ? 'Shipped' : 'Tracking updated'}: {result.trackingNumber}
              {result.replayed && ' (already done earlier)'}
            </div>
            <button onClick={onClose} style={{ width: '100%' }}>Close</button>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-message" role="alert">{error}</div>}
            <div className="form-group">
              <label htmlFor="seller-carrier">Carrier</label>
              <select id="seller-carrier" value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={busy || !providers} required>
                <option value="">{providers ? 'Choose a carrier' : 'Loading…'}</option>
                {providers?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {providers?.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  No carriers for this delivery option. Run “Sync Logistics” on the Shops page.
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="seller-tracking">Tracking number</label>
              <input
                id="seller-tracking"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                disabled={busy}
                required
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="button-group">
              <button type="submit" disabled={busy || !providerId || !tracking.trim()}>
                {busy ? 'Saving…' : mode === 'ship' ? 'Mark as shipped' : 'Save tracking'}
              </button>
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface ImportRow {
  line: number;
  reference: string;
  provider: string;
  trackingNumber: string;
  status: 'ok' | 'error';
  error: string | null;
}

/** Upload or paste a tracking CSV, check it, then import the valid rows as a background job (#60). */
export function TrackingImportDialog({ onClose, onStarted }: { onClose: () => void; onStarted: (jobId: string) => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ rows: ImportRow[]; ok: number; errors: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setPreview(null);
  };

  const check = async () => {
    setBusy(true);
    setError('');
    try {
      setPreview(await apiPost('/v1/fulfillment/tracking-import/preview', { csv }));
    } catch (err: any) {
      setError(err.message || 'Could not read the file');
    } finally {
      setBusy(false);
    }
  };

  const importRows = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiPost<{ jobId: string }>('/v1/fulfillment/tracking-import', { csv });
      onStarted(res.jobId);
    } catch (err: any) {
      setError(err.message || 'Import failed');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Import tracking numbers" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px' }}>
        <div className="modal-title">Import tracking numbers</div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          For orders shipped with your own carrier. Columns: order or package ID, carrier (name or ID), tracking number.{' '}
          <a href="/v1/fulfillment/tracking-import/template" download>Download template</a>
        </p>
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="form-group">
          <label htmlFor="tracking-file">CSV file</label>
          <input id="tracking-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
        </div>
        <div className="form-group">
          <label htmlFor="tracking-csv">…or paste rows</label>
          <textarea
            id="tracking-csv"
            rows={6}
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
            disabled={busy}
            style={{ width: '100%', fontFamily: 'monospace' }}
            placeholder={'ORDER123,Kerry Express,KEX0001234\nPKG456,Flash Express,TH0123456789'}
          />
        </div>

        {preview && (
          <div style={{ maxHeight: '260px', overflow: 'auto', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', marginBottom: '6px' }}>
              <strong>{preview.ok}</strong> ready, <strong>{preview.errors}</strong> with problems
              {preview.errors > 0 && ' (these rows will be skipped)'}
            </div>
            <table>
              <thead>
                <tr><th>Line</th><th>ID</th><th>Carrier</th><th>Tracking</th><th>Result</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.reference}</td>
                    <td>{r.provider}</td>
                    <td>{r.trackingNumber}</td>
                    <td style={{ color: r.status === 'ok' ? 'inherit' : 'var(--error-color, #c62828)' }}>
                      {r.status === 'ok' ? 'Ready' : r.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="button-group">
          <button className="secondary" onClick={check} disabled={busy || !csv.trim()}>Check file</button>
          <button onClick={importRows} disabled={busy || !preview || preview.ok === 0}>
            {preview ? `Import ${preview.ok} row${preview.ok === 1 ? '' : 's'}` : 'Import'}
          </button>
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
