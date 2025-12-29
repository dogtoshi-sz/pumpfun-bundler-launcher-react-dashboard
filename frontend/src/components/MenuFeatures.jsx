import { useState } from 'react';
import apiService from '../services/api';

const commands = [
  { id: 'rapid-sell', name: 'Rapid Sell Tokens', description: 'Sells 100% from all wallets', color: 'red' },
  { id: 'rapid-sell-50-percent', name: 'Sell 50% of Wallets', description: 'Sells 100% from half, keeps other half', color: 'orange' },
  { id: 'rapid-sell-remaining', name: 'Sell Remaining Wallets', description: 'Sells kept wallets + dev wallet', color: 'red' },
  { id: 'gather', name: 'Gather Wallets', description: 'Recover SOL from current run', color: 'green' },
  { id: 'gather-all', name: 'Gather All Wallets', description: 'Recover SOL from all wallets', color: 'green' },
  { id: 'check-bundle', name: 'Check Bundle Status', description: 'Check bundle transaction status', color: 'blue' },
  { id: 'status', name: 'Check Token Status', description: 'Check current token status', color: 'blue' },
  { id: 'check-balance', name: 'Check Balance', description: 'Check wallet balances', color: 'blue' },
  { id: 'collect-fees', name: 'Collect Creator Fees', description: 'Collect Pump.fun creator fees', color: 'purple' },
];

export default function MenuFeatures() {
  const [running, setRunning] = useState({});
  const [outputs, setOutputs] = useState({});

  const executeCommand = async (commandId) => {
    setRunning({ ...running, [commandId]: true });
    setOutputs({ ...outputs, [commandId]: 'Executing...' });

    try {
      const res = await apiService.executeCommand(commandId);
      setOutputs({
        ...outputs,
        [commandId]: res.data.output || res.data.message || 'Command executed',
      });
    } catch (error) {
      setOutputs({
        ...outputs,
        [commandId]: 'Error: ' + (error.response?.data?.error || error.message),
      });
    } finally {
      setRunning({ ...running, [commandId]: false });
    }
  };

  const getColorClasses = (color) => {
    const colors = {
      red: 'bg-red-600 hover:bg-red-700',
      orange: 'bg-orange-600 hover:bg-orange-700',
      green: 'bg-green-600 hover:bg-green-700',
      blue: 'bg-blue-600 hover:bg-blue-700',
      purple: 'bg-purple-600 hover:bg-purple-700',
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6">
      <h2 className="text-2xl font-bold mb-6 text-white">📋 Menu Features</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {commands.map((cmd) => (
          <div key={cmd.id} className="bg-slate-700 rounded-lg p-4">
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-1">{cmd.name}</h3>
                <p className="text-sm text-slate-400">{cmd.description}</p>
              </div>
              <button
                onClick={() => executeCommand(cmd.id)}
                disabled={running[cmd.id]}
                className={`px-4 py-2 ${getColorClasses(cmd.color)} text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-4`}
              >
                {running[cmd.id] ? 'Running...' : 'Run'}
              </button>
            </div>
            {outputs[cmd.id] && (
              <div className="mt-3 p-2 bg-slate-800 rounded text-xs text-slate-300 font-mono max-h-32 overflow-y-auto">
                {outputs[cmd.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


