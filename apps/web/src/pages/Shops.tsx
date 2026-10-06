import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api';
import { formatDate } from '../utils';
import type { ShopSummary, WarehouseView } from '@oms/core/types';

interface WarehouseModalProps {
  warehouse: WarehouseView;
  shopId: string;
  userRole: string;
  onClose: () => void;
  onSave: () => void;
}

function WarehouseModal({ warehouse, shopId, userRole, onClose, onSave }: WarehouseModalProps) {
  const [defaultHandover, setDefaultHandover] = useState(warehouse.defaultHandoverMethod || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      await apiPatch(`/v1/shops/${shopId}/warehouses/${warehouse.id}`, {
        defaultHandoverMethod: defaultHandover || null,
      });
      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save warehouse');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{warehouse.name}</div>
        {error && <div className="error-message">{error}</div>}

        <div style={{ fontSize: '13px', lineHeight: '1.8', marginBottom: '16px' }}>
          <div><strong>Shop ID:</strong> {warehouse.shopId}</div>
          <div><strong>Default:</strong> {warehouse.isDefault ? 'Yes' : 'No'}</div>
        </div>

        {userRole === 'admin' && (
          <div className="form-group">
            <label htmlFor="handover">Default Handover Method</label>
            <select
              id="handover"
              value={defaultHandover}
              onChange={(e) => setDefaultHandover(e.target.value)}
              disabled={loading}
            >
              <option value="">Not Set</option>
              <option value="PICKUP">Pickup</option>
              <option value="DROP_OFF">Drop Off</option>
            </select>
          </div>
        )}

        <div className="drawer-section">
          <div className="drawer-section-title">Delivery Options</div>
          {warehouse.deliveryOptions.length === 0 ? (
            <div className="empty-state"><p>No delivery options</p></div>
          ) : (
            warehouse.deliveryOptions.map((opt) => (
              <div key={opt.id} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: '500' }}>{opt.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Providers: {opt.providers.map((p) => p.name).join(', ')}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="button-group" style={{ marginTop: '20px' }}>
          {userRole === 'admin' && <button onClick={handleSave} disabled={loading}>Save</button>}
          <button onClick={onClose} className="secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

export function ShopsPage({ userRole }: { userRole: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [warehouses, setWarehouses] = useState<Record<string, WarehouseView[]>>({});
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseView | null>(null);
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

  const fetchWarehouses = async (shopId: string) => {
    try {
      const data = await apiGet<WarehouseView[]>(`/v1/shops/${shopId}/warehouses`);
      setWarehouses((prev) => ({ ...prev, [shopId]: data }));
    } catch (err: any) {
      setError(err.message || 'Failed to load warehouses');
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

  const toggleShop = async (shopId: string) => {
    if (expandedShop === shopId) {
      setExpandedShop(null);
    } else {
      setExpandedShop(shopId);
      if (!warehouses[shopId]) {
        await fetchWarehouses(shopId);
      }
    }
  };

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
            <div onClick={() => toggleShop(shop.id)} style={{ cursor: 'pointer' }}>
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
                    <a href={`/auth/tiktok/connect?region=${shop.region}`} style={{ marginBottom: '8px', display: 'block' }}>
                      <button>Reconnect</button>
                    </a>
                  )}
                  {userRole !== 'viewer' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); handleResync(shop.id); }} style={{ marginBottom: '8px', display: 'block' }} className="secondary">
                        Resync
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleSyncLogistics(shop.id); }} className="secondary">
                        Sync Logistics
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {expandedShop === shop.id && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                <h4>Warehouses</h4>
                {warehouses[shop.id] && warehouses[shop.id]!.length > 0 ? (
                  warehouses[shop.id]!.map((warehouse) => (
                    <div
                      key={warehouse.id}
                      style={{
                        padding: '12px',
                        marginTop: '8px',
                        backgroundColor: 'var(--bg-primary)',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div><strong>{warehouse.name}</strong> {warehouse.isDefault && <span className="badge">Default</span>}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Handover: {warehouse.defaultHandoverMethod || 'Not set'}
                        </div>
                      </div>
                      <button onClick={() => setSelectedWarehouse(warehouse)} className="secondary">
                        View
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state"><p>No warehouses</p></div>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {selectedWarehouse && (
        <WarehouseModal
          warehouse={selectedWarehouse}
          shopId={selectedWarehouse.shopId}
          userRole={userRole}
          onClose={() => setSelectedWarehouse(null)}
          onSave={fetchShops}
        />
      )}
    </div>
  );
}
