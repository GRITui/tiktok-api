import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ShopSummary, WarehouseView } from '@oms/core/types';
import { ShopsPage } from './Shops';
import * as api from '../api';

vi.mock('../api');
const apiGet = vi.mocked(api.apiGet);
const apiPatch = vi.mocked(api.apiPatch);

const shop: ShopSummary = {
  id: 'S1', name: 'Demo TH', region: 'TH', authRegion: 'ROW', active: true, authorizationId: 'A1',
  authStatus: 'revoked', accessTokenExpiresAt: '2026-10-13T00:00:00Z', refreshTokenExpiresAt: '2026-12-01T00:00:00Z',
  lastSyncedAt: null, backfillStatus: 'done', backfillProgress: 1, webhooksSubscribedAt: null,
};
const warehouses = (defaultId: string, handover: WarehouseView['defaultHandoverMethod'] = null): WarehouseView[] => [
  { shopId: 'S1', id: 'W1', name: 'Bangkok', isDefault: defaultId === 'W1', defaultHandoverMethod: handover,
    deliveryOptions: [{ id: 'D1', name: 'Standard', providers: [{ id: 'P1', name: 'J&T' }] }] },
  { shopId: 'S1', id: 'W2', name: 'Chiang Mai', isDefault: defaultId === 'W2', defaultHandoverMethod: null, deliveryOptions: [] },
];

function mockApi(whs: () => WarehouseView[]) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/v1/shops') return [shop];
    if (path === '/v1/shops/S1/warehouses') return whs();
    throw new Error('unexpected ' + path);
  });
}

const renderPage = (role: string) =>
  render(<MemoryRouter><ShopsPage userRole={role} /></MemoryRouter>);

describe('ShopsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
  });

  it('reconnects a revoked shop with its authorization region, not the shop market', async () => {
    mockApi(() => warehouses('W1'));
    renderPage('admin');
    const link = (await screen.findByText('Reconnect')).closest('a');
    expect(link?.getAttribute('href')).toBe('/auth/tiktok/connect?region=ROW');
  });

  it('lets an admin make a warehouse default and set its handover method', async () => {
    let current = warehouses('W1');
    mockApi(() => current);
    apiPatch.mockImplementation(async (_path, body: any) => {
      if (body.isDefault) current = warehouses('W2');
      if ('defaultHandoverMethod' in body) current = warehouses('W1', body.defaultHandoverMethod);
      return undefined as any;
    });
    renderPage('admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Warehouses' }));

    const w2 = await screen.findByTestId('warehouse-W2');
    fireEvent.click(within(w2).getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/v1/shops/S1/warehouses/W2', { isDefault: true }));
    await waitFor(() => expect(within(screen.getByTestId('warehouse-W2')).getByText('Default')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Default handover', { selector: '#handover-W1' }), { target: { value: 'DROP_OFF' } });
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/v1/shops/S1/warehouses/W1', { defaultHandoverMethod: 'DROP_OFF' }),
    );
  });

  it('shows delivery options and carriers on demand', async () => {
    mockApi(() => warehouses('W1'));
    renderPage('ops');
    fireEvent.click(await screen.findByRole('button', { name: 'Warehouses' }));
    fireEvent.click(await screen.findByRole('button', { name: '1 delivery option' }));
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText(/J&T/)).toBeInTheDocument();
  });

  it('is read-only for non-admins', async () => {
    mockApi(() => warehouses('W1', 'PICKUP'));
    renderPage('ops');
    fireEvent.click(await screen.findByRole('button', { name: 'Warehouses' }));
    await screen.findByTestId('warehouse-W1');
    expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
  });
});
