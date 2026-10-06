import React, { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../api';
import { SellerShipDialog } from '../components/SellerShipping';
import { formatDate, formatCurrency, buildQueryString, getTimeRemaining, isOverdue } from '../utils';
import type { OrderListItem, OrderDetail, Page } from '@oms/core/types';

interface OrderDrawerProps {
  orderId: string;
  onClose: () => void;
  userRole: string;
}

function OrderDrawer({ orderId, onClose, userRole }: OrderDrawerProps) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editTracking, setEditTracking] = useState<{ id: string; trackingNumber: string | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const data = await apiGet<OrderDetail>(`/v1/orders/${orderId}`);
        setOrder(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load order');
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [orderId, reload]);

  if (loading) {
    return (
      <div>
        <div className="drawer-overlay" onClick={onClose}></div>
        <div className="drawer">
          <div className="spinner" style={{ margin: '20px auto' }}></div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div>
        <div className="drawer-overlay" onClick={onClose}></div>
        <div className="drawer">
          <div className="error-message">{error || 'Order not found'}</div>
          <button onClick={onClose} style={{ marginTop: '16px' }}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="drawer-overlay" onClick={onClose}></div>
      <div className="drawer">
        <div className="drawer-title">
          <div>Order {orderId}</div>
          <button onClick={onClose} className="secondary">Close</button>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Basic Info</div>
          <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
            <div><strong>Shop:</strong> {order.shopName}</div>
            <div><strong>Status:</strong> <span className="status-badge">{order.status}</span></div>
            <div><strong>Total Amount:</strong> {formatCurrency(order.totalAmount, order.currency)}</div>
            <div><strong>Items:</strong> {order.itemCount}</div>
            <div><strong>Created:</strong> {formatDate(order.createdAt)}</div>
            {order.rtsSlaAt && (
              <div><strong>Ship by:</strong> {formatDate(order.rtsSlaAt)} ({getTimeRemaining(order.rtsSlaAt)})</div>
            )}
            {order.shippingType && <div><strong>Shipping:</strong> {order.shippingType}</div>}
          </div>
        </div>

        {order.buyerMessage && (
          <div className="drawer-section">
            <div className="drawer-section-title">Buyer Message</div>
            <div style={{ fontSize: '13px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {order.buyerMessage}
            </div>
          </div>
        )}

        {order.recipient && userRole !== 'viewer' && (
          <div className="drawer-section">
            <div className="drawer-section-title">Recipient</div>
            <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(order.recipient, null, 2)}
            </div>
          </div>
        )}

        <div className="drawer-section">
          <div className="drawer-section-title">Line Items</div>
          {order.lineItems.length === 0 ? (
            <div className="empty-state"><p>No items</p></div>
          ) : (
            order.lineItems.map((item) => (
              <div key={item.id} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: '500' }}>{item.productName}</div>
                {item.skuName && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>SKU: {item.skuName}</div>}
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Price: {formatCurrency(item.salePrice)}</div>
                {item.displayStatus && <div className="badge" style={{ marginTop: '4px' }}>{item.displayStatus}</div>}
              </div>
            ))
          )}
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Packages</div>
          {order.packages.length === 0 ? (
            <div className="empty-state"><p>No packages</p></div>
          ) : (
            order.packages.map((pkg) => (
              <div key={pkg.id} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: '500' }}>Package {pkg.id}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {pkg.status && <div>Status: {pkg.status}</div>}
                  {pkg.trackingNumber && <div>Tracking: {pkg.trackingNumber}</div>}
                  {pkg.shippingProvider && <div>Provider: {pkg.shippingProvider}</div>}
                </div>
                {pkg.shippingType === 'SELLER' && pkg.shippedAt && userRole !== 'viewer' && (
                  <button
                    className="secondary"
                    style={{ marginTop: '6px' }}
                    onClick={() => setEditTracking({ id: pkg.id, trackingNumber: pkg.trackingNumber })}
                  >
                    Edit tracking
                  </button>
                )}
                {pkg.timeline.length > 0 && (
                  <div className="timeline" style={{ marginTop: '8px', fontSize: '12px' }}>
                    {pkg.timeline.map((event, idx) => (
                      <div key={idx} className="timeline-item">
                        <div className="timeline-item-status">{event.status}</div>
                        <div className="timeline-item-time">{formatDate(event.at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      {editTracking && (
        <SellerShipDialog
          packageId={editTracking.id}
          mode="edit"
          currentTrackingNumber={editTracking.trackingNumber}
          onClose={() => setEditTracking(null)}
          onDone={() => setReload((n) => n + 1)}
        />
      )}
    </div>
  );
}

export function OrdersPage({ userRole }: { userRole: string }) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Filters
  const [shopId, setShopId] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sku, setSku] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [sla, setSla] = useState('');

  const fetchOrders = async (cursor?: string) => {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (shopId) params.shopId = shopId;
      if (status) params.status = status;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      if (sku) params.sku = sku;
      if (searchQ) params.q = searchQ;
      if (sla) params.sla = sla;
      if (cursor) params.cursor = cursor;

      const queryStr = buildQueryString(params);
      const data = await apiGet<Page<OrderListItem>>(`/v1/orders${queryStr}`);
      if (cursor) {
        setOrders([...orders, ...data.items]);
      } else {
        setOrders(data.items);
      }
      setNextCursor(data.nextCursor);
    } catch (err: any) {
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const params: any = {};
      if (shopId) params.shopId = shopId;
      if (status) params.status = status;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      if (sku) params.sku = sku;
      if (searchQ) params.q = searchQ;
      if (sla) params.sla = sla;

      const result = await apiPost<{ jobId: string }>('/v1/exports/orders', params);
      // Navigate to job view or show notification
      window.location.href = `/jobs/${result.jobId}`;
    } catch (err: any) {
      setError(err.message || 'Export failed');
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  return (
    <div>
      <h2>Orders</h2>

      {error && <div className="error-message">{error}</div>}

      <div className="filter-panel">
        <div className="filter-row">
          <div className="form-group">
            <label>Shop ID</label>
            <input value={shopId} onChange={(e) => setShopId(e.target.value)} placeholder="Filter by shop" />
          </div>
          <div className="form-group">
            <label>Status</label>
            <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Filter by status" />
          </div>
          <div className="form-group">
            <label>SKU</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Filter by SKU" />
          </div>
        </div>
        <div className="filter-row">
          <div className="form-group">
            <label>Created From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Created To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>SLA</label>
            <select value={sla} onChange={(e) => setSla(e.target.value)}>
              <option value="">All</option>
              <option value="overdue">Overdue</option>
              <option value="lt24h">Less than 24h</option>
              <option value="later">Later</option>
            </select>
          </div>
        </div>
        <div className="filter-row">
          <div className="form-group">
            <label>Search (Order ID or Buyer)</label>
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search" />
          </div>
        </div>
        <div className="button-group">
          <button onClick={() => fetchOrders()}>Apply Filters</button>
          {userRole !== 'viewer' && <button className="secondary" onClick={handleExport}>Export CSV</button>}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="empty-state">
          <h3>No orders found</h3>
          <p>Try adjusting your filters</p>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Shop</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Items</th>
                <th>Created</th>
                <th>Ship By</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} onClick={() => setSelectedOrderId(order.id)} style={{ cursor: 'pointer' }}>
                  <td><strong>{order.id}</strong></td>
                  <td>{order.shopName}</td>
                  <td><span className="status-badge">{order.status}</span></td>
                  <td>{formatCurrency(order.totalAmount, order.currency)}</td>
                  <td>{order.itemCount}</td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>
                    {order.rtsSlaAt && (
                      <span className={isOverdue(order.rtsSlaAt) ? 'badge overdue' : 'badge lt24h'}>
                        {getTimeRemaining(order.rtsSlaAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {nextCursor && (
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button onClick={() => fetchOrders(nextCursor)}>Load More</button>
            </div>
          )}
        </>
      )}

      {selectedOrderId && (
        <OrderDrawer orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} userRole={userRole} />
      )}
    </div>
  );
}
