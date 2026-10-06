import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api';
import { formatDate } from '../utils';
import type { ShopSummary, WarehouseView } from '@oms/core/types';

type HandoverMethod = 'PICKUP' | 'DROP_OFF';

/** Warehouses of one shop: default warehouse, default handover method, delivery options and carriers (#29). */
export function WarehousesPanel({ shopId, userRole }: { shopId: string; userRole: string }) {
  const [warehouses, setWarehouses] = useState<WarehouseView[] | null>(null);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openOptions, setOpenOptions] = useState<Record<string, boolean>>({});
  const isAdmin = userRole === 'admin';

  const load = async () => {
    setError('');
    try {
      setWarehouses(await apiGet<WarehouseView[]>(`/v1/shops/${shopId}/warehouses`));
    } catch (err: any) {
      setError(err.message || 'Failed to load warehouses');
    }
  };

  useEffect(() => {
    load();
  }, [shopId]);

  const save = async (warehouseId: string, body: { isDefault?: boolean; defaultHandoverMethod?: HandoverMethod | null }) => {
    setSavingId(warehouseId);
    setError('');
    try {
      await apiPatch(`/v1/shops/${shopId}/warehouses/${warehouseId}`, body);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to save warehouse');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Warehouses</h4>
        <button className="secondary" onClick={load}>Refresh</button>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {warehouses === null ? (
        <div className="spinner" style={{ margin: '12px auto' }}></div>
      ) : warehouses.length === 0 ? (
        <div className="empty-state">
          <p>No warehouses yet. Use “Sync Logistics”, then Refresh.</p>
        </div>
      ) : (
        warehouses.map((wh) => {
          const busy = savingId === wh.id;
          return (
            <div
              key={wh.id}
              data-testid={`warehouse-${wh.id}`}
              style={{ padding: '12px', marginTop: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <strong>{wh.name}</strong> {wh.isDefault && <span className="badge">Default</span>}
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ID {wh.id}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <label htmlFor={`handover-${wh.id}`} style={{ fontSize: '13px', margin: 0 }}>Default handover</label>
                  {isAdmin ? (
                    <select
                      id={`handover-${wh.id}`}
                      value={wh.defaultHandoverMethod ?? ''}
                      disabled={busy}
                      onChange={(e) => save(wh.id, { defaultHandoverMethod: (e.target.value || null) as HandoverMethod | null })}
                    >
                      <option value="">Not set</option>
                      <option value="PICKUP">Pickup</option>
                      <option value="DROP_OFF">Drop-off</option>
                    </select>
                  ) : (
                    <span id={`handover-${wh.id}`}>{wh.defaultHandoverMethod === 'DROP_OFF' ? 'Drop-off' : wh.defaultHandoverMethod === 'PICKUP' ? 'Pickup' : 'Not set'}</span>
                  )}
                  {isAdmin && !wh.isDefault && (
                    <button className="secondary" disabled={busy} onClick={() => save(wh.id, { isDefault: true })}>
                      Make default
                    </button>
                  )}
                </div>
              </div>
              <button
                className="link-button"
                style={{ marginTop: '8px', background: 'none', border: 'none', padding: 0, color: 'var(--badge-text)', cursor: 'pointer' }}
                aria-expanded={!!openOptions[wh.id]}
                onClick={() => setOpenOptions((o) => ({ ...o, [wh.id]: !o[wh.id] }))}
              >
                {wh.deliveryOptions.length} delivery option{wh.deliveryOptions.length === 1 ? '' : 's'}
              </button>
              {openOptions[wh.id] && (
                <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '13px' }}>
                  {wh.deliveryOptions.map((opt) => (
                    <li key={opt.id}>
                      {opt.name}
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {' — '}
                        {opt.providers.length ? opt.providers.map((p) => p.name).join(', ') : 'no carriers'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function ShopsPage({ userRole }: { userRole: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedShop, setExpandedShop] = useState<string | null>(null);

  const connected = useMemo(() => searchParams.get('connected') === '1', [searchParams]);
  const errorParam = useMemo(() => searchParams.get('error'), [searchParams]);

  useEffect(() => {
    if (connected) {
      setBanner({ type: 'success', message: 'Shop connected successfully!' });
      setSearchParams({});
    }
    if (errorParam) {
      setBanner({ type: 'error', message: `Connection failed: ${errorParam}` });
      setSearchParams({});
    }
  }, [connected, errorParam, setSearchParams]);

  const fetchShops = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet<ShopSummary[]>('/v1/shops');
      setShops(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load shops');
    } finally {
      setLoading(false);
    }
  };

  const handleResync = async (shopId: string) => {
    try {
      await apiPost(`/v1/shops/${shopId}/resync`, {});
      setBanner({ type: 'success', message: 'Resync started' });
      fetchShops();
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Resync failed' });
    }
  };

  const handleSyncLogistics = async (shopId: string) => {
    try {
      await apiPost(`/v1/shops/${shopId}/logistics/sync`, {});
      setBanner({ type: 'success', message: 'Logistics sync started' });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Sync failed' });
    }
  };

  const toggleShop = (shopId: string) => setExpandedShop((cur) => (cur === shopId ? null : shopId));

  useEffect(() => {
    fetchShops();
  }, []);

  if (loading) {
    return <div className="spinner" style={{ margin: '20px auto' }}></div>;
  }

  return (
    <div>
      <h2>Shops</h2>

      {banner && (
        <div className={`banner ${banner.type}`}>
          <div>{banner.message}</div>
          <button className="secondary" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {userRole === 'admin' && (
        <div style={{ marginBottom: '16px' }}>
          <a href="/auth/tiktok/connect?region=US" style={{ marginRight: '12px' }}>
            <button>Connect Shop - US</button>
          </a>
          <a href="/auth/tiktok/connect?region=ROW">
            <button>Connect Shop - ROW</button>
          </a>
        </div>
      )}

      {shops.length === 0 ? (
        <div className="empty-state">
          <h3>No shops connected</h3>
          <p>Connect a shop to get started</p>
        </div>
      ) : (
        shops.map((shop) => (
          <div key={shop.id} className="card" style={{ marginBottom: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ marginBottom: '8px' }}>{shop.name}</h3>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <div>Region: {shop.region} | Status: {shop.active ? 'Active' : 'Inactive'}</div>
                    <div>Auth: <span className={`badge ${shop.authStatus === 'active' ? '' : 'warning'}`}>{shop.authStatus}</span></div>
                    <div>Last Synced: {shop.lastSyncedAt ? formatDate(shop.lastSyncedAt) : 'Never'}</div>
                    <div>Backfill: {shop.backfillStatus} {shop.backfillProgress !== null && `(${Math.round(shop.backfillProgress * 100)}%)`}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {shop.authStatus === 'revoked' && userRole === 'admin' && (
                    <a href={`/auth/tiktok/connect?region=${shop.authRegion}`} style={{ marginBottom: '8px', display: 'block' }}>
                      <button>Reconnect</button>
                    </a>
                  )}
                  {userRole !== 'viewer' && (
                    <>
                      <button onClick={() => handleResync(shop.id)} style={{ marginBottom: '8px', display: 'block' }} className="secondary">
                        Resync
                      </button>
                      <button onClick={() => handleSyncLogistics(shop.id)} style={{ marginBottom: '8px', display: 'block' }} className="secondary">
                        Sync Logistics
                      </button>
                    </>
                  )}
                  <button
                    className="secondary"
                    aria-expanded={expandedShop === shop.id}
                    onClick={() => toggleShop(shop.id)}
                  >
                    {expandedShop === shop.id ? 'Hide warehouses' : 'Warehouses'}
                  </button>
                </div>
              </div>
            </div>

            {expandedShop === shop.id && <WarehousesPanel shopId={shop.id} userRole={userRole} />}
          </div>
        ))
      )}

    </div>
  );
}
