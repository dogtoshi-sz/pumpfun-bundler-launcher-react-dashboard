# Profit/Loss Tracking System

## Overview

The profit/loss tracking system automatically tracks funding wallet balance before and after each token launch to calculate profit/loss per token and cumulative totals.

## How It Works

1. **Start Tracking**: When `index.ts` starts, it records the funding wallet balance BEFORE any funds are sent out
2. **Complete Tracking**: After `gather.ts` completes (or manually), it records the balance AFTER all SOL is gathered
3. **Calculate P/L**: Profit/Loss = Balance After - Balance Before
4. **Cumulative**: Tracks total profit/loss across all runs

## Files Created

- **`lib/profit-loss-tracker.ts`** - Core tracking logic
- **`keys/profit-loss.json`** - Data storage (auto-created)

## API Endpoint

### GET `/api/profit-loss`

Returns all profit/loss records:

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "run-1234567890",
        "timestamp": "2025-01-07T10:30:00.000Z",
        "tokenName": "My Token",
        "tokenSymbol": "MTK",
        "mintAddress": "ABC123...",
        "balanceBefore": 100.5,
        "balanceAfter": 102.3,
        "profitLoss": 1.8,
        "status": "completed"
      }
    ],
    "cumulativeProfitLoss": 5.2,
    "lastUpdated": "2025-01-07T10:35:00.000Z"
  }
}
```

## Integration Points

### Automatic Tracking

Tracking is automatically started and completed in:
- **`index.ts`** - Starts tracking at line ~97 (after balance check, before any transactions)
- **`gather.ts`** - Completes tracking after gather finishes
- **`index.ts`** - Completes tracking after auto-gather (if enabled) or marks as failed if launch fails

### Manual Completion

If `AUTO_GATHER` is false, tracking will complete automatically when you manually run `npm run gather`.

## Adding UI Tab

Add this HTML/JavaScript to your control panel to display profit/loss data:

```html
<!-- Add to your tabs navigation -->
<button onclick="showProfitLoss()" class="tab-button">Profit/Loss</button>

<!-- Add tab content -->
<div id="profitLossTab" style="display: none;">
  <h2>Profit/Loss Tracking</h2>
  <div id="profitLossContent">
    <p>Loading...</p>
  </div>
</div>

<script>
async function showProfitLoss() {
  // Hide other tabs, show this one
  document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
  document.getElementById('profitLossTab').style.display = 'block';
  
  // Fetch data
  const response = await fetch('/api/profit-loss');
  const result = await response.json();
  
  if (!result.success) {
    document.getElementById('profitLossContent').innerHTML = '<p>Error loading data</p>';
    return;
  }
  
  const data = result.data;
  const records = data.records || [];
  
  // Build HTML table
  let html = `
    <div style="margin-bottom: 20px;">
      <h3>Cumulative Profit/Loss: <span style="color: ${data.cumulativeProfitLoss >= 0 ? 'green' : 'red'}">
        ${data.cumulativeProfitLoss >= 0 ? '+' : ''}${data.cumulativeProfitLoss.toFixed(4)} SOL
      </span></h3>
    </div>
    
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f0f0f0;">
          <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Date</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Token</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Mint</th>
          <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Balance Before</th>
          <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Balance After</th>
          <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Profit/Loss</th>
          <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">Status</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  if (records.length === 0) {
    html += '<tr><td colspan="7" style="padding: 20px; text-align: center;">No records yet. Launch a token to start tracking!</td></tr>';
  } else {
    records.reverse().forEach(record => {
      const date = new Date(record.timestamp).toLocaleString();
      const profitLoss = record.profitLoss || 0;
      const color = profitLoss >= 0 ? 'green' : 'red';
      const sign = profitLoss >= 0 ? '+' : '';
      
      html += `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${date}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${record.tokenName || 'N/A'} (${record.tokenSymbol || 'N/A'})</td>
          <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 12px;">
            ${record.mintAddress ? record.mintAddress.slice(0, 8) + '...' + record.mintAddress.slice(-8) : 'N/A'}
          </td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${record.balanceBefore.toFixed(4)} SOL</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${record.balanceAfter.toFixed(4)} SOL</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd; color: ${color}; font-weight: bold;">
            ${sign}${profitLoss.toFixed(4)} SOL
          </td>
          <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">
            <span style="padding: 4px 8px; border-radius: 4px; background: ${
              record.status === 'completed' ? '#d4edda' : 
              record.status === 'failed' ? '#f8d7da' : 
              '#fff3cd'
            }; color: ${
              record.status === 'completed' ? '#155724' : 
              record.status === 'failed' ? '#721c24' : 
              '#856404'
            };">
              ${record.status.toUpperCase()}
            </span>
          </td>
        </tr>
      `;
    });
  }
  
  html += `
      </tbody>
    </table>
  `;
  
  document.getElementById('profitLossContent').innerHTML = html;
}
</script>
```

## Data Storage

Data is stored in `keys/profit-loss.json`:

```json
{
  "records": [
    {
      "id": "run-1234567890",
      "timestamp": "2025-01-07T10:30:00.000Z",
      "tokenName": "My Token",
      "tokenSymbol": "MTK",
      "mintAddress": "ABC123...",
      "balanceBefore": 100.5,
      "balanceAfter": 102.3,
      "profitLoss": 1.8,
      "status": "completed",
      "notes": "Optional notes"
    }
  ],
  "cumulativeProfitLoss": 5.2,
  "lastUpdated": "2025-01-07T10:35:00.000Z"
}
```

## Status Values

- **`in_progress`** - Run started but gather not completed yet
- **`completed`** - Run completed successfully, gather finished
- **`failed`** - Launch failed (bundle not included on-chain)

## Notes

- Tracking starts automatically on every run
- If `AUTO_GATHER` is false, tracking completes when you manually run `npm run gather`
- Failed launches are tracked with status `failed`
- Cumulative profit/loss only includes `completed` runs
- All balances are in SOL (not lamports)

## Testing

To test the system:

1. Launch a token - tracking will start automatically
2. After gather completes - tracking will complete automatically
3. Check `/api/profit-loss` endpoint - should show your run
4. Launch another token - cumulative will update

## Future Enhancements

Potential improvements:
- Export to CSV
- Filter by date range
- Filter by token
- Chart visualization
- Per-token statistics
