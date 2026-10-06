import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SellerShipDialog, TrackingImportDialog } from './SellerShipping';
import { JobProgress } from '../pages/Fulfillment';
import * as api from '../api';

vi.mock('../api');
const apiGet = vi.mocked(api.apiGet);
const apiPost = vi.mocked(api.apiPost);
const apiPut = vi.mocked(api.apiPut);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SellerShipDialog', () => {
  it('ships with carrier + tracking and an Idempotency-Key', async () => {
    apiGet.mockResolvedValueOnce([{ id: 'KERRY', name: 'Kerry Express' }]);
    apiPost.mockResolvedValueOnce({ packageId: 'P1', status: 'SHIPPED', trackingNumber: 'KEX123', replayed: false });
    const onDone = vi.fn();
    render(<SellerShipDialog packageId="P1" mode="ship" onClose={() => {}} onDone={onDone} />);

    await waitFor(() => expect((screen.getByLabelText('Carrier') as HTMLSelectElement).value).toBe('KERRY'));
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'KEX123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [path, body, opts] = apiPost.mock.calls[0]!;
    expect(path).toBe('/v1/packages/P1/ship-seller');
    expect(body).toEqual({ shippingProviderId: 'KERRY', trackingNumber: 'KEX123' });
    expect((opts as RequestInit).headers).toHaveProperty('Idempotency-Key');
    expect(screen.getByRole('status')).toHaveTextContent('Shipped: KEX123');
  });

  it('edits tracking with PUT and shows TikTok errors', async () => {
    apiGet.mockResolvedValueOnce([{ id: 'KERRY', name: 'Kerry' }, { id: 'FLASH', name: 'Flash' }]);
    apiPut.mockRejectedValueOnce(Object.assign(new Error('Parcel already collected'), { details: { ttsCode: 21000 } }));
    render(<SellerShipDialog packageId="P1" mode="edit" currentTrackingNumber="OLD1" onClose={() => {}} onDone={() => {}} />);

    expect((screen.getByLabelText('Tracking number') as HTMLInputElement).value).toBe('OLD1');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Flash' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'FLASH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Parcel already collected (TikTok 21000)');
    expect(apiPut.mock.calls[0]![0]).toBe('/v1/packages/P1/tracking');
  });
});

describe('TrackingImportDialog', () => {
  it('checks the file, then imports only when there are valid rows', async () => {
    apiPost
      .mockResolvedValueOnce({
        rows: [
          { line: 1, reference: 'O1', provider: 'Kerry', trackingNumber: 'K1234', status: 'ok', error: null },
          { line: 2, reference: 'X', provider: 'Kerry', trackingNumber: 'K5678', status: 'error', error: 'No order or package with this id' },
        ],
        ok: 1,
        errors: 1,
      })
      .mockResolvedValueOnce({ jobId: 'J1', accepted: 1, rejected: [] });
    const onStarted = vi.fn();
    render(<TrackingImportDialog onClose={() => {}} onStarted={onStarted} />);

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('…or paste rows'), { target: { value: 'O1,Kerry,K1234\nX,Kerry,K5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    expect(await screen.findByText('No order or package with this id')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 row' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('J1'));
    expect(apiPost.mock.calls[1]![0]).toBe('/v1/fulfillment/tracking-import');
  });
});

describe('JobProgress', () => {
  const job = (over: object) => ({
    id: 'J1', type: 'batch_ship', status: 'partial', total: 3, succeeded: 2, failed: 1, error: null,
    downloadUrl: null, createdAt: '', finishedAt: '',
    items: [
      { targetId: 'P1', status: 'succeeded', error: null },
      { targetId: 'P2', status: 'succeeded', error: null },
      { targetId: 'P3', status: 'failed', error: 'handover_required' },
    ],
    ...over,
  });

  it('after a batch ship, offers labels for shipped packages and retries only failures', async () => {
    apiGet.mockResolvedValue(job({}));
    const onRetry = vi.fn();
    const onPrintShipped = vi.fn();
    const onFinished = vi.fn();
    render(<JobProgress jobId="J1" onClose={() => {}} onRetry={onRetry} onPrintShipped={onPrintShipped} onFinished={onFinished} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Print for 2 shipped' }));
    expect(onPrintShipped).toHaveBeenCalledWith(['P1', 'P2'], 'SHIPPING_LABEL');
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed' }));
    expect(onRetry).toHaveBeenCalledWith(['P3']);
    expect(onFinished).toHaveBeenCalled();
  });

  it('does not offer printing for label jobs (retry stays with the parent)', async () => {
    apiGet.mockResolvedValue(job({ type: 'labels', downloadUrl: '/v1/jobs/J1/download' }));
    render(<JobProgress jobId="J1" onClose={() => {}} onRetry={() => {}} onPrintShipped={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Print for/ })).toBeNull();
  });
});
