import React, { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { Chart, registerables } from "chart.js/auto";
import "./App.css";

Chart.register(...registerables);

const MAX_ROWS = 10000;      // maximum rows to store/preview
const PREVIEW_CHUNK = 200;   // rows loaded per "Load more" click
const MAX_CHARTS = 10;       // create up to 10 auto charts

export default function App() {
  const [page, setPage] = useState("landing"); // 'landing' | 'dashboard'
  const fullCaption = "Turn CSV into charts & instant insights — fast.";
  const [typedCaption, setTypedCaption] = useState("");
  const typingSpeed = 30;

  // data state
  const [allRows, setAllRows] = useState([]); // array of objects (headers keys)
  const [visibleRowsCount, setVisibleRowsCount] = useState(0); // preview rows shown
  const [columns, setColumns] = useState([]);
  const [insights, setInsights] = useState({ numeric: {}, categorical: {} });
  const [rowCount, setRowCount] = useState(0);

  // charts state
  const [autoCharts, setAutoCharts] = useState([]); // [{ id, colX, colY?, type }]
  const chartRefs = useRef({}); // store chart instances

  // selection
  const [selectedChartConfig, setSelectedChartConfig] = useState(null);

  // drag state
  const [dragActive, setDragActive] = useState(false);

  // on landing show typing animation
  useEffect(() => {
    if (page !== "landing") return;
    setTypedCaption("");
    let i = 0;
    const id = setInterval(() => {
      setTypedCaption((s) => s + fullCaption[i]);
      i++;
      if (i >= fullCaption.length) clearInterval(id);
    }, typingSpeed);
    return () => clearInterval(id);
  }, [page]);

  // ---------- parsing & loading ----------
  function handleFiles(files) {
    if (!files || !files.length) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload a .csv file");
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      worker: true, // use worker for big files
      chunkSize: 1024 * 1024,
      chunk: function (results, parser) {
        // incremental chunk push, but cap at MAX_ROWS
        setAllRows((prev) => {
          const accum = prev.concat(results.data);
          if (accum.length >= MAX_ROWS) {
            parser.abort(); // stop parsing once we hit max
            return accum.slice(0, MAX_ROWS);
          }
          return accum.slice(0, MAX_ROWS);
        });
      },
      complete: function () {
        // finalize
        setRowCount((r) => {
          // if already set by chunking, keep, else set from allRows
          return Math.min(allRows.length, MAX_ROWS) || Math.min(MAX_ROWS, allRows.length);
        });
        // final compute will happen in useEffect below once allRows state updates
      },
      error: function (err) {
        alert("CSV parse error: " + err.message);
      },
    });
    // reset preview counter
    setVisibleRowsCount(0);
    // reset existing charts and insights until complete
    setAutoCharts([]);
    setInsights({ numeric: {}, categorical: {} });
  }

  // For drag & drop of large files as text
  function handleTextPasteOrLoadText(text) {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        const rows = results.data.slice(0, MAX_ROWS);
        setAllRows(rows);
        setRowCount(rows.length);
      },
      error: (err) => alert("CSV parse error: " + err.message),
    });
  }

  // watch for allRows update and compute insights + auto-charts
  useEffect(() => {
    if (!allRows || !allRows.length) {
      setColumns([]);
      setRowCount(0);
      setVisibleRowsCount(0);
      setAutoCharts([]);
      setInsights({ numeric: {}, categorical: {} });
      return;
    }
    const rows = allRows.slice(0, MAX_ROWS);
    const cols = Object.keys(rows[0] || {});
    setColumns(cols);
    setRowCount(rows.length);
    setVisibleRowsCount(Math.min(PREVIEW_CHUNK, rows.length));

    const { numeric, categorical } = computeInsights(rows);
    setInsights({ numeric, categorical });

    // auto-create up to MAX_CHARTS config based on data
    const configs = buildAutoChartsConfig(cols, numeric, categorical);
    setAutoCharts(configs.slice(0, MAX_CHARTS));
  }, [allRows]);

  // ---------- preview load more ----------
  function loadMorePreview() {
    setVisibleRowsCount((v) => {
      const next = Math.min(v + PREVIEW_CHUNK, Math.min(allRows.length, MAX_ROWS));
      return next;
    });
  }

  // ---------- insights compute ----------
  function isNumericString(s) {
    if (s === null || s === undefined) return false;
    const t = String(s).trim();
    if (t === "") return false;
    const cleaned = t.replace(/,/g, "");
    return !Number.isNaN(Number(cleaned));
  }
  function toNumber(s) {
    return Number(String(s).replace(/,/g, "").trim());
  }
  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function median(arr) {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 === 0 ? (a[mid - 1] + a[mid]) / 2 : a[mid];
  }
  function stdev(arr) {
    if (!arr.length) return null;
    const m = mean(arr);
    const variance = arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  function computeInsights(rows) {
    const cols = Object.keys(rows[0] || {});
    const colValues = {};
    for (const c of cols) colValues[c] = [];
    for (const r of rows) {
      for (const c of cols) {
        const v = r[c] === undefined ? "" : r[c];
        colValues[c].push(String(v));
      }
    }

    const numeric = {};
    const categorical = {};
    for (const c of cols) {
      const vals = colValues[c];
      const nonEmpty = vals.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      const numericCount = nonEmpty.reduce((acc, v) => acc + (isNumericString(v) ? 1 : 0), 0);
      const ratio = nonEmpty.length === 0 ? 0 : numericCount / nonEmpty.length;

      if (ratio >= 0.8 && nonEmpty.length > 0) {
        const nums = nonEmpty.map(toNumber).filter((v) => Number.isFinite(v));
        numeric[c] = {
          count: nums.length,
          mean: Number((mean(nums) || 0).toFixed(6)),
          median: Number((median(nums) || 0).toFixed(6)),
          min: Math.min(...nums),
          max: Math.max(...nums),
          stdev: Number((stdev(nums) || 0).toFixed(6)),
          sample: nums.slice(0, 5000),
          histogram: buildHistogram(nums, 12),
        };
      } else {
        const freq = {};
        for (const v of nonEmpty) {
          const k = v === "" ? "__EMPTY__" : v;
          freq[k] = (freq[k] || 0) + 1;
        }
        const freqArr = Object.entries(freq).map(([value, count]) => ({ value, count }));
        freqArr.sort((a, b) => b.count - a.count);
        categorical[c] = {
          uniqueCount: freqArr.length,
          top: freqArr.slice(0, 20),
        };
      }
    }
    return { numeric, categorical };
  }

  function buildHistogram(nums, bins = 12) {
    if (!nums.length) return [];
    const min = Math.min(...nums), max = Math.max(...nums);
    if (min === max) return [{ binStart: min, binEnd: max, count: nums.length }];
    const width = (max - min) / bins;
    const res = [];
    for (let i = 0; i < bins; i++) res.push({ binStart: min + i * width, binEnd: i === bins - 1 ? max : min + (i + 1) * width, count: 0});
    for (const v of nums) {
      let idx = Math.floor((v - min) / width); if (idx < 0) idx = 0; if (idx >= bins) idx = bins - 1;
      res[idx].count++;
    }
    return res;
  }

  // ---------- auto chart selection ----------
  function buildAutoChartsConfig(cols, numeric, categorical) {
    const configs = [];
    // 1) For numeric columns: histogram + line (if many rows/time trend)
    const numericCols = Object.keys(numeric);
    const catCols = Object.keys(categorical);
    // Prefer numeric histograms first
    for (const c of numericCols) {
      configs.push({ id: `hist_${c}`, type: "histogram", colX: c });
      if (configs.length >= MAX_CHARTS) return configs;
    }
    // For categorical: bar/pie
    for (const c of catCols) {
      configs.push({ id: `bar_${c}`, type: "bar", colX: c });
      if (configs.length >= MAX_CHARTS) return configs;
      configs.push({ id: `pie_${c}`, type: "pie", colX: c });
      if (configs.length >= MAX_CHARTS) return configs;
    }
    // Create scatter pairs for numeric pairs
    for (let i = 0; i < numericCols.length && configs.length < MAX_CHARTS; i++) {
      for (let j = i + 1; j < numericCols.length && configs.length < MAX_CHARTS; j++) {
        configs.push({ id: `scatter_${numericCols[i]}_${numericCols[j]}`, type: "scatter", colX: numericCols[i], colY: numericCols[j] });
      }
    }
    // If still space, create correlation matrix chart rendered as heatmap later
    if (numericCols.length >= 2 && configs.length < MAX_CHARTS) {
      configs.push({ id: `corr_matrix`, type: "corr", cols: numericCols.slice(0, Math.min(10, numericCols.length)) });
    }
    return configs;
  }

  // ---------- Chart rendering ----------
  useEffect(() => {
    // Whenever autoCharts changes or insights changes, create/destroy chart instances
    // Destroy old
    Object.values(chartRefs.current).forEach((inst) => {
      try { inst.destroy(); } catch (e) {}
    });
    chartRefs.current = {};

    // Create new charts after a tick to ensure DOM present
    setTimeout(() => {
      autoCharts.forEach((cfg, idx) => {
        const canvas = document.getElementById("chart-canvas-" + cfg.id);
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        // Build dataset depending on type
        let chartConfig = null;
        if (cfg.type === "histogram" && insights.numeric[cfg.colX]) {
          const hist = insights.numeric[cfg.colX].histogram;
          chartConfig = {
            type: "bar",
            data: {
              labels: hist.map(h => `${Number(h.binStart.toFixed(2))}–${Number(h.binEnd.toFixed(2))}`),
              datasets: [{ label: cfg.colX, data: hist.map(h => h.count) }]
            },
            options: { responsive: true, maintainAspectRatio: false }
          };
        } else if (cfg.type === "bar" && insights.categorical[cfg.colX]) {
          const top = insights.categorical[cfg.colX].top.slice(0, 12);
          chartConfig = {
            type: "bar",
            data: { labels: top.map(t => t.value), datasets: [{ label: cfg.colX, data: top.map(t => t.count) }] },
            options: { responsive: true, maintainAspectRatio: false }
          };
        } else if (cfg.type === "pie" && insights.categorical[cfg.colX]) {
          const top = insights.categorical[cfg.colX].top.slice(0, 8);
          chartConfig = {
            type: "pie",
            data: { labels: top.map(t => t.value), datasets: [{ data: top.map(t => t.count) }] },
            options: { responsive: true, maintainAspectRatio: false }
          };
        } else if (cfg.type === "scatter" && insights.numeric[cfg.colX] && insights.numeric[cfg.colY]) {
          // scatter uses sample arrays (aligned by row index)
          const rows = allRows.slice(0, MAX_ROWS);
          const pts = [];
          for (let r = 0; r < rows.length; r++) {
            const a = rows[r][cfg.colX], b = rows[r][cfg.colY];
            if (isNumericString(a) && isNumericString(b)) pts.push({ x: toNumber(a), y: toNumber(b) });
            if (pts.length >= 2000) break; // cap
          }
          chartConfig = {
            type: "scatter",
            data: { datasets: [{ label: `${cfg.colX} vs ${cfg.colY}`, data: pts, pointRadius: 3 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: cfg.colX } }, y: { title: { display: true, text: cfg.colY } } } }
          };
        } else if (cfg.type === "corr") {
          // correlation; we will render heatmap separately using HTML
          chartConfig = null;
        } else {
          // fallback: if selected column numeric, show histogram; if categorical show bar
          if (cfg.colX && insights.numeric[cfg.colX]) {
            const hist = insights.numeric[cfg.colX].histogram;
            chartConfig = { type: "bar", data: { labels: hist.map(h => `${Number(h.binStart.toFixed(2))}–${Number(h.binEnd.toFixed(2))}`), datasets: [{ label: cfg.colX, data: hist.map(h => h.count) }] }, options: { responsive: true, maintainAspectRatio: false } };
          } else if (cfg.colX && insights.categorical[cfg.colX]) {
            const top = insights.categorical[cfg.colX].top.slice(0, 10);
            chartConfig = { type: "bar", data: { labels: top.map(t => t.value), datasets: [{ label: cfg.colX, data: top.map(t => t.count) }] }, options: { responsive: true, maintainAspectRatio: false } };
          }
        }

        if (chartConfig) {
          try {
            const created = new Chart(ctx, chartConfig);
            chartRefs.current[cfg.id] = created;
          } catch (err) {
            console.error("Chart create err:", err);
          }
        }
      });
    }, 50);
    // cleanup on unmount
    return () => {
      Object.values(chartRefs.current).forEach((inst) => {
        try { inst.destroy(); } catch (e) {}
      });
    };
  }, [autoCharts, insights, allRows]);

  // ---------- helpers for UI actions ----------
  function regenerateAutoCharts() {
    const configs = buildAutoChartsConfig(columns, insights.numeric, insights.categorical);
    setAutoCharts(configs.slice(0, MAX_CHARTS));
  }

  function changeChartType(chartId, newType) {
    setAutoCharts((prev) => prev.map((c) => (c.id === chartId ? { ...c, type: newType } : c)));
  }

  // correlation computation
  function pearson(a, b) {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    const n = a.length;
    const meanA = mean(a), meanB = mean(b);
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - meanA) * (b[i] - meanB);
      denA += (a[i] - meanA) ** 2;
      denB += (b[i] - meanB) ** 2;
    }
    return num / Math.sqrt(denA * denB || 1);
  }

  function buildCorrelationMatrix(numericCols) {
    const rows = allRows.slice(0, MAX_ROWS);
    const matrix = {};
    const colArrays = {};
    for (const c of numericCols) {
      colArrays[c] = rows.map((r) => isNumericString(r[c]) ? toNumber(r[c]) : NaN).filter(v => !Number.isNaN(v));
    }
    for (let i = 0; i < numericCols.length; i++) {
      const a = numericCols[i];
      matrix[a] = {};
      for (let j = 0; j < numericCols.length; j++) {
        const b = numericCols[j];
        // build aligned arrays where both numeric
        const paired = [];
        for (const r of rows) {
          if (isNumericString(r[a]) && isNumericString(r[b])) {
            paired.push([toNumber(r[a]), toNumber(r[b])]);
          }
        }
        if (paired.length < 5) matrix[a][b] = 0;
        else {
          const arrA = paired.map(p => p[0]), arrB = paired.map(p => p[1]);
          matrix[a][b] = pearson(arrA, arrB);
        }
      }
    }
    return matrix;
  }

  // ---------- heatmap render helpers ----------
  function renderPivotHeatmap(colA, colB) {
    // pivot counts of colA x colB
    const rows = allRows.slice(0, MAX_ROWS);
    const map = {}; // map[a][b]=count
    const aVals = new Set(), bVals = new Set();
    for (const r of rows) {
      const a = String(r[colA] || "__EMPTY__");
      const b = String(r[colB] || "__EMPTY__");
      aVals.add(a); bVals.add(b);
      map[a] = map[a] || {};
      map[a][b] = (map[a][b] || 0) + 1;
    }
    const aList = Array.from(aVals).slice(0, 25); // limit labels for visual
    const bList = Array.from(bVals).slice(0, 25);
    // get max count for color scaling
    let max = 0;
    for (const a of aList) for (const b of bList) {
      if ((map[a] || {})[b]) max = Math.max(max, map[a][b]);
    }
    return (
      <div className="heatmap-wrapper">
        <div className="heatmap-title">Heatmap: {colA} × {colB}</div>
        <div className="heatmap-table-outer">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th></th>
                {bList.map(b => <th key={b} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", padding: "4px 8px" }}>{b}</th>)}
              </tr>
            </thead>
            <tbody>
              {aList.map(a => (
                <tr key={a}>
                  <th className="heatmap-row-label">{a}</th>
                  {bList.map(b => {
                    const v = (map[a] || {})[b] || 0;
                    const intensity = max === 0 ? 0 : v / max;
                    const bg = `rgba(26,115,232, ${0.15 + 0.85 * intensity})`;
                    return <td key={b} style={{ background: bg, textAlign: "center" }}>{v > 0 ? v : ""}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderCorrHeatmap() {
    const numericCols = Object.keys(insights.numeric || {});
    const cols = numericCols.slice(0, 10);
    if (cols.length < 2) return <div className="empty">Need at least 2 numeric columns for correlation heatmap</div>;
    const mat = buildCorrelationMatrix(cols);
    return (
      <div className="heatmap-wrapper">
        <div className="heatmap-title">Correlation matrix (Pearson)</div>
        <div className="heatmap-table-outer">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th></th>
                {cols.map(c => <th key={c} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", padding: "4px 8px" }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {cols.map(a => (
                <tr key={a}>
                  <th className="heatmap-row-label">{a}</th>
                  {cols.map(b => {
                    const val = mat[a]?.[b] || 0;
                    const intensity = Math.abs(val);
                    const color = val >= 0 ? `rgba(26,115,232, ${0.2 + 0.8*intensity})` : `rgba(220,38,38, ${0.2 + 0.8*intensity})`;
                    return <td key={b} style={{ background: color, textAlign: "center" }}>{val.toFixed(2)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ---------- drag handlers ----------
  function handleDrag(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  }

  // ---------- render UI ----------
  function Landing() {
    return (
      <div className="landing-container">
        <div className="landing-inner">
          <h1 className="landing-title">CSV → Charts & Insights</h1>
          <p className="landing-caption"><span className="typed">{typedCaption}</span><span className="cursor" /></p>

          <div className="landing-icons">
            <div className="icon-card">
              <img src="https://cdn-icons-png.flaticon.com/512/4248/4248443.png" alt="CSV" />
              <p>CSV</p>
            </div>
            <div className="icon-card">
              <img src="https://cdn-icons-png.flaticon.com/512/906/906343.png" alt="Chart" />
              <p>Chart</p>
            </div>
            <div className="icon-card">
              <img src="https://cdn-icons-png.flaticon.com/512/2203/2203183.png" alt="Insights" />
              <p>Insights</p>
            </div>
          </div>

          <button className="go-btn" onClick={() => setPage("dashboard")}>Go →</button>
        </div>
      </div>
    );
  }

  function Dashboard() {
    return (
      <div className="dashboard-container">
        <header className="dash-header">
          <h2>CSV Dashboard</h2>
          <div className="summary">
            <div>Rows: <strong>{rowCount || "-"}</strong></div>
            <div>Columns: <strong>{columns.length || "-"}</strong></div>
            <div><button onClick={regenerateAutoCharts} className="regen-btn">Regenerate Charts</button></div>
          </div>
        </header>

        <main className="dash-grid">
          <section className={`upload-area ${dragActive ? "active" : ""}`} onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
            <p>Drag & Drop CSV here</p>
            <p>or</p>
            <label className="browse-btn">
              Browse
              <input type="file" accept=".csv" hidden onChange={(e) => handleFiles(e.target.files)} />
            </label>
            <div className="small-note">Tip: first row must contain headers. Files will be parsed client-side (max {MAX_ROWS} rows).</div>
          </section>

          <section className="preview-panel">
            <h3>Preview (first {visibleRowsCount} rows of {Math.min(allRows.length, MAX_ROWS)})</h3>
            <div className="preview-table">
              <table>
                <thead>
                  <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {allRows.slice(0, visibleRowsCount).map((r, i) => (
                    <tr key={i}>
                      {columns.map(c => <td key={c + i}>{String(r[c] ?? "")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!allRows.length && <div className="empty">No data loaded yet</div>}
              {visibleRowsCount < Math.min(allRows.length, MAX_ROWS) && (
                <div className="load-more-row">
                  <button onClick={loadMorePreview}>Load more rows (next {PREVIEW_CHUNK})</button>
                </div>
              )}
              {visibleRowsCount >= Math.min(allRows.length, MAX_ROWS) && allRows.length > 0 && <div className="small-note">All loaded rows shown (or reached {MAX_ROWS} cap).</div>}
            </div>
          </section>

          <section className="charts-panel">
            <h3>Auto Charts (up to {MAX_CHARTS})</h3>
            <div className="charts-grid">
              {autoCharts.map((cfg, idx) => (
                <div className="chart-card" key={cfg.id}>
                  <div className="chart-card-head">
                    <div><strong>{cfg.type.toUpperCase()}</strong> {cfg.colX ? `• ${cfg.colX}` : ""} {cfg.colY ? ` vs ${cfg.colY}` : ""}</div>
                    <div>
                      <select value={cfg.type} onChange={(e) => changeChartType(cfg.id, e.target.value)}>
                        <option value="histogram">Histogram</option>
                        <option value="line">Line</option>
                        <option value="area">Area</option>
                        <option value="bar">Bar</option>
                        <option value="stacked">Stacked</option>
                        <option value="pie">Pie</option>
                        <option value="donut">Donut</option>
                        <option value="scatter">Scatter</option>
                        <option value="corr">Correlation</option>
                      </select>
                    </div>
                  </div>

                  <div className="chart-canvas-small">
                    {cfg.type === "corr" ? (
                      <div className="small-heat">{renderCorrHeatmap()}</div>
                    ) : (
                      <canvas id={"chart-canvas-" + cfg.id} />
                    )}
                  </div>
                </div>
              ))}
              {!autoCharts.length && <div className="empty">No charts yet — upload a CSV to auto-generate charts</div>}
            </div>

            {/* extra heatmap/pivot helper: allow picking two categorical cols */}
            <div style={{ marginTop: 12 }}>
              <h4>Pivot Heatmap (choose two categorical columns)</h4>
              <PivotHeatmapControl columns={columns} categorical={insights.categorical || {}} renderPivotHeatmap={renderPivotHeatmap} />
            </div>
          </section>

          <section className="insight-panel">
            <h3>Insights</h3>
            <div className="insight-scroll">
              <div className="insight-block">
                <h4>Numeric summaries</h4>
                {Object.keys(insights.numeric || {}).length === 0 && <div className="empty">No numeric columns detected</div>}
                {Object.entries(insights.numeric || {}).map(([col, sim]) => (
                  <div key={col} className="numeric-card">
                    <div className="num-head">{col} <span className="muted">({sim.count} non-empty)</span></div>
                    <div className="num-grid">
                      <div>Mean: <b>{sim.mean}</b></div>
                      <div>Median: <b>{sim.median}</b></div>
                      <div>Min: <b>{sim.min}</b></div>
                      <div>Max: <b>{sim.max}</b></div>
                      <div>Std: <b>{sim.stdev}</b></div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="insight-block">
                <h4>Categorical summaries</h4>
                {Object.keys(insights.categorical || {}).length === 0 && <div className="empty">No categorical columns detected</div>}
                {Object.entries(insights.categorical || {}).map(([col, cs]) => (
                  <div key={col} className="cat-card">
                    <div className="cat-head">{col} <span className="muted">({cs.uniqueCount} unique)</span></div>
                    <div className="top-list">
                      {cs.top.slice(0, 8).map((t) => (
                        <div key={t.value} className="top-item">
                          <div className="val">{t.value}</div>
                          <div className="cnt">{t.count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="insight-block">
                <h4>Correlation (top numeric cols)</h4>
                {renderCorrHeatmap()}
              </div>

            </div>
          </section>
        </main>
      </div>
    );
  }

  return page === "landing" ? <Landing /> : <Dashboard />;
}

// ---------- small helper components ----------
function PivotHeatmapControl({ columns, categorical, renderPivotHeatmap }) {
  const catCols = Object.keys(categorical || {});
  const [a, setA] = useState(catCols[0] || "");
  const [b, setB] = useState(catCols[1] || "");
  useEffect(() => { setA(catCols[0] || ""); setB(catCols[1] || ""); }, [categorical]);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">-- select col A --</option>
          {catCols.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">-- select col B --</option>
          {catCols.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 10 }}>
        {a && b ? renderPivotHeatmap(a, b) : <div className="muted">Select two categorical columns to see a pivot heatmap</div>}
      </div>
    </div>
  );
}
