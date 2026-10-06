export function formatDate(isoString: string | null): string {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(isoString: string | null): string {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getTimeRemaining(rtsSlaAt: string | null): string {
  if (!rtsSlaAt) return 'N/A';
  const now = new Date();
  const sla = new Date(rtsSlaAt);
  const diff = sla.getTime() - now.getTime();

  if (diff < 0) return 'Overdue';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function isOverdue(rtsSlaAt: string | null): boolean {
  if (!rtsSlaAt) return false;
  const now = new Date();
  const sla = new Date(rtsSlaAt);
  return sla.getTime() < now.getTime();
}

export function buildQueryString(params: Record<string, any>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });
  const str = query.toString();
  return str ? `?${str}` : '';
}

export function formatCurrency(amount: string | null, currency: string = 'USD'): string {
  if (!amount) return 'N/A';
  try {
    const num = parseFloat(amount);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(num);
  } catch {
    return amount;
  }
}

export function truncate(str: string, length: number = 30): string {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}
