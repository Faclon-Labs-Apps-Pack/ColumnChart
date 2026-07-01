import { useState, useEffect, useMemo } from 'react';
import { ColumnChart } from './components/ColumnChart/ColumnChart';
import { ColumnChartConfiguration } from './components/ColumnChartConfiguration/ColumnChartConfiguration';
import { ColumnChartEnvelope, DataEntry, WidgetEvent } from './iosense-sdk/types';
import { validateSSOToken } from './iosense-sdk/api';
import { resolve } from './iosense-sdk/mini-engine';
import '@faclon-labs/design-sdk/styles.css';
import './App.css';

export default function App() {
  const [envelope, setEnvelope] = useState<ColumnChartEnvelope | undefined>(undefined);
  const [data, setData] = useState<DataEntry[]>([]);
  const [auth, setAuth] = useState<string>(localStorage.getItem('bearer_token') ?? '');
  const [timeOverride, setTimeOverride] = useState<{ startTime: number; endTime: number; periodicity?: string; comparisonStartTime?: number; comparisonEndTime?: number } | undefined>(undefined);
  // Widget size is fixed at 880×400 in the dev harness regardless of any
  // widgetSize hint in the envelope.
  const widgetSize = { width: 880, height: 400 };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('token');
    if (ssoToken && !auth) {
      validateSSOToken(ssoToken)
        .then((jwt) => {
          if (jwt) {
            localStorage.setItem('bearer_token', jwt);
            setAuth(jwt);
            const url = new URL(window.location.href);
            url.searchParams.delete('token');
            window.history.replaceState({}, '', url.toString());
          }
        })
        .catch(console.error);
    }
  }, []);

  // Resolve only depends on data-relevant fields — the binding list (which
  // UNS topics to fetch) and the time config (which window to fetch over).
  // Style/widget/element changes from the configurator emit a new envelope
  // every keystroke; without this gate, every color tweak would refire a
  // 5-6s network round-trip and cause perceived UI lag.
  const fetchKey = useMemo(() => JSON.stringify({
    bindings: envelope?.dynamicBindingPathList,
    timeConfig: envelope?.timeConfig,
  }), [envelope?.dynamicBindingPathList, envelope?.timeConfig]);

  useEffect(() => {
    if (!envelope || !auth) return;
    console.log('[App] resolving envelope:', envelope.dynamicBindingPathList, 'override:', timeOverride);
    resolve(envelope, { authentication: auth, override: timeOverride }).then(({ data: resolved }) => {
      console.log('[App] resolved data:', resolved);
      setData(resolved);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, auth, timeOverride]);

  function handleEvent(event: WidgetEvent) {
    console.log('[Widget Event]', event);
    if (event.type === 'TIME_CHANGE') {
      setTimeOverride({
        startTime: Number(event.payload.startTime),
        endTime: Number(event.payload.endTime),
        periodicity: event.payload.periodicity,
        ...(event.payload.comparisonStartTime != null ? { comparisonStartTime: Number(event.payload.comparisonStartTime) } : {}),
        ...(event.payload.comparisonEndTime != null ? { comparisonEndTime: Number(event.payload.comparisonEndTime) } : {}),
      });
    }
  }

  return (
    <div className="app">
      <div className="app__config">
        <ColumnChartConfiguration config={envelope} authentication={auth} onChange={setEnvelope} />
      </div>
      <div
        className="app__widget"
        style={envelope ? { flex: '0 0 auto', width: widgetSize.width, height: widgetSize.height } : undefined}
      >
        {envelope ? (
          <ColumnChart config={envelope.uiConfig} data={data} onEvent={handleEvent} timeConfig={envelope.timeConfig} />
        ) : (
          <div className="app__empty">
            <p className="BodyMediumRegular">Configure the widget in the left panel to preview it here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
