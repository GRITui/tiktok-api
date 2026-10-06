import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrdersPage } from './Orders';
import * as api from '../api';

vi.mock('../api');

const mockApiGet = vi.mocked(api.apiGet);
const mockApiPost = vi.mocked(api.apiPost);

describe('OrdersPage', () => {
  beforeEach(() => {
    mockApiGet.mockClear();
    mockApiPost.mockClear();
  });

  it('should render orders table', async () => {
    mockApiGet.mockResolvedValueOnce({
      items: [
        {
          id: 'order123',
          shopId: 'shop1',
          shopName: 'Test Shop',
          status: 'AWAITING_SHIPMENT',
          currency: 'USD',
          totalAmount: '100.00',
          itemCount: 2,
          createdAt: '2024-01-01T00:00:00Z',
          rtsSlaAt: '2024-01-02T00:00:00Z',
          shippingType: 'STANDARD',
          recipientName: 'John Doe',
        },
      ],
      nextCursor: null,
    });

    render(<OrdersPage userRole="ops" />);

    await waitFor(() => {
      expect(screen.getByText('order123')).toBeInTheDocument();
      expect(screen.getByText('Test Shop')).toBeInTheDocument();
    });
  });

  it('should apply filters correctly', async () => {
    mockApiGet.mockResolvedValueOnce({ items: [], nextCursor: null });

    render(<OrdersPage userRole="ops" />);

    const shopInput = screen.getByPlaceholderText('Filter by shop');
    fireEvent.change(shopInput, { target: { value: 'shop1' } });

    const applyButton = screen.getByText('Apply Filters');
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        expect.stringContaining('shopId=shop1')
      );
    });
  });

  it('should build correct query string with multiple filters', async () => {
    mockApiGet.mockResolvedValueOnce({ items: [], nextCursor: null });

    render(<OrdersPage userRole="ops" />);

    const shopInput = screen.getByPlaceholderText('Filter by shop');
    const skuInput = screen.getByPlaceholderText('Filter by SKU');

    fireEvent.change(shopInput, { target: { value: 'shop1' } });
    fireEvent.change(skuInput, { target: { value: 'sku123' } });

    const applyButton = screen.getByText('Apply Filters');
    fireEvent.click(applyButton);

    await waitFor(() => {
      const calls = mockApiGet.mock.calls;
      const lastCall = calls[calls.length - 1];
      const url = lastCall?.[0] as string;
      expect(url).toContain('shopId=shop1');
      expect(url).toContain('sku=sku123');
    });
  });

  it('should show export button for ops role', async () => {
    mockApiGet.mockResolvedValueOnce({ items: [], nextCursor: null });

    render(<OrdersPage userRole="ops" />);

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });
  });

  it('should hide export button for viewer role', async () => {
    mockApiGet.mockResolvedValueOnce({ items: [], nextCursor: null });

    render(<OrdersPage userRole="viewer" />);

    await waitFor(() => {
      expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
    });
  });

  it('should handle load more cursor', async () => {
    mockApiGet
      .mockResolvedValueOnce({
        items: [
          {
            id: 'order1',
            shopId: 'shop1',
            shopName: 'Test Shop',
            status: 'AWAITING_SHIPMENT',
            currency: 'USD',
            totalAmount: '100.00',
            itemCount: 1,
            createdAt: '2024-01-01T00:00:00Z',
            rtsSlaAt: '2024-01-02T00:00:00Z',
            shippingType: 'STANDARD',
            recipientName: 'John Doe',
          },
        ],
        nextCursor: 'cursor123',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'order2',
            shopId: 'shop1',
            shopName: 'Test Shop',
            status: 'AWAITING_SHIPMENT',
            currency: 'USD',
            totalAmount: '200.00',
            itemCount: 1,
            createdAt: '2024-01-01T00:00:00Z',
            rtsSlaAt: '2024-01-02T00:00:00Z',
            shippingType: 'STANDARD',
            recipientName: 'Jane Doe',
          },
        ],
        nextCursor: null,
      });

    render(<OrdersPage userRole="viewer" />);

    await waitFor(() => {
      expect(screen.getByText('order1')).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByText('Load More');
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(screen.getByText('order2')).toBeInTheDocument();
    });
  });
});
