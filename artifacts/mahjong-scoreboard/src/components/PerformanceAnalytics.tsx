import type { MahjongSession } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Coins, Flame, Flower2, Trophy } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildWinRates,
  buildWinningsData,
  getPlayerIdentities,
  type WinningsPoint,
} from "./performanceAnalyticsData";

const PLAYER_COLORS = [
  { light: "#00a866", dark: "#00f291" },
  { light: "#006fd6", dark: "#55adff" },
  { light: "#d67c00", dark: "#ffd000" },
  { light: "#e22d3f", dark: "#ff6666" },
  { light: "#7c3aed", dark: "#b794f6" },
  { light: "#a33d00", dark: "#ff9b57" },
  { light: "#007b83", dark: "#4de3ec" },
  { light: "#b21f7d", dark: "#ff70c5" },
];

function buildIncidentData(sessions: MahjongSession[]) {
  return [...sessions]
    .sort(
      (a, b) => a.playedOn.localeCompare(b.playedOn) || a.id - b.id,
    )
    .map((session) => ({
    date: session.playedOn,
    dateLabel: format(parseISO(session.playedOn), "MMM d"),
    zhaHu: session.playerBalances.reduce(
      (total, player) => total + (player.zhaHuCount ?? 0),
      0,
    ),
    xieXie: session.playerBalances.reduce(
      (total, player) => total + (player.xieXieKaiXiangCount ?? 0),
      0,
    ),
    }));
}

function formatSignedCurrency(amount: number) {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function AnalyticsTooltip({
  active,
  payload,
  label,
  playerNames,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number | string;
    color?: string;
    payload?: WinningsPoint;
  }>;
  label?: string;
  playerNames: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;

  return (
    <div className="min-w-48 border-2 border-ink bg-popover p-3 text-popover-foreground brutal-shadow-sm">
      <p className="mb-2 border-b-2 border-ink pb-2 font-black uppercase">
        {label}
      </p>
      <div className="space-y-2">
        {payload.map((item) => {
          const key = String(item.dataKey);
          const value = Number(item.value);
          const delta = point?.[`${key}Delta`];
          return (
            <div key={key} className="flex items-center justify-between gap-5 text-xs">
              <span className="flex items-center gap-2 font-black uppercase">
                <span
                  className="h-3 w-3 border border-ink"
                  style={{ backgroundColor: item.color }}
                />
                {playerNames.get(key) ?? key}
              </span>
              <span className="text-right font-mono font-bold">
                {formatSignedCurrency(value)}
                {typeof delta === "number" && (
                  <span className="ml-2 text-muted-foreground">
                    ({formatSignedCurrency(delta)})
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PerformanceAnalytics({
  sessions,
}: {
  sessions: MahjongSession[];
}) {
  const players = getPlayerIdentities(sessions);
  const winningsData = buildWinningsData(sessions, players);
  const winRates = buildWinRates(sessions, players);
  const incidentData = buildIncidentData(sessions);
  const [focusedPlayers, setFocusedPlayers] = useState<Set<string>>(
    () => new Set(),
  );
  const { resolvedTheme } = useTheme();
  const playerNames = new Map(
    players.map((player) => [player.seriesKey, player.name]),
  );

  const winningsConfig = Object.fromEntries(
    players.map((player, index) => [
      player.seriesKey,
      {
        label: player.name,
        theme: {
          light: PLAYER_COLORS[index % PLAYER_COLORS.length].light,
          dark: PLAYER_COLORS[index % PLAYER_COLORS.length].dark,
        },
      },
    ]),
  ) satisfies ChartConfig;

  const winRateConfig = {
    winRate: {
      label: "Win rate",
      theme: { light: "#00a866", dark: "#00f291" },
    },
  } satisfies ChartConfig;

  const incidentConfig = {
    zhaHu: {
      label: "Zha Hu",
      theme: { light: "#e22d3f", dark: "#ff6666" },
    },
    xieXie: {
      label: "谢谢 Kai Xiang",
      theme: { light: "#006fd6", dark: "#55adff" },
    },
  } satisfies ChartConfig;

  function togglePlayer(key: string) {
    setFocusedPlayers((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hasWinnings = winningsData.length > 0 && players.length > 0;
  const hasIncidents = incidentData.some(
    (session) => session.zhaHu > 0 || session.xieXie > 0,
  );

  return (
    <section aria-labelledby="analytics-title">
      <div className="mb-5 flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-foreground" strokeWidth={3} />
        <div>
          <h2 id="analytics-title" className="text-2xl text-foreground">
            Performance Analytics
          </h2>
          <p className="font-bold text-muted-foreground">
            See how every Friday changes the table.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="bg-card lg:col-span-2">
          <CardContent className="p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-lg text-foreground">
                  <Coins className="h-5 w-5" strokeWidth={3} />
                  Winnings Over Time
                </h3>
                <p className="text-sm font-bold text-muted-foreground">
                  Running net result. Tooltip brackets show that session’s change.
                </p>
              </div>
              {focusedPlayers.size > 0 && (
                <button
                  type="button"
                  onClick={() => setFocusedPlayers(new Set())}
                  className="self-start font-black uppercase underline decoration-2 underline-offset-4"
                >
                  Show all
                </button>
              )}
            </div>

            {hasWinnings ? (
              <>
                <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter players">
                  {players.map((player, index) => {
                    const selected =
                      focusedPlayers.size === 0 || focusedPlayers.has(player.key);
                    return (
                      <button
                        key={player.key}
                        type="button"
                        aria-pressed={focusedPlayers.has(player.key)}
                        onClick={() => togglePlayer(player.key)}
                        className={`flex items-center gap-2 border-2 border-ink px-3 py-1 text-xs font-black uppercase transition-opacity ${
                          selected ? "bg-tile brutal-shadow-sm" : "bg-muted opacity-45"
                        }`}
                      >
                        <span
                          className="h-3 w-3 border border-ink"
                          style={{
                            backgroundColor:
                              PLAYER_COLORS[index % PLAYER_COLORS.length][
                                resolvedTheme === "dark" ? "dark" : "light"
                              ],
                          }}
                        />
                        {player.name}
                      </button>
                    );
                  })}
                </div>
                <ChartContainer
                  config={winningsConfig}
                  className="h-[280px] w-full aspect-auto sm:h-[360px]"
                >
                  <LineChart
                    data={winningsData}
                    margin={{ top: 16, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      dataKey="dateLabel"
                      tickLine={false}
                      axisLine={{ strokeWidth: 2 }}
                      minTickGap={18}
                    />
                    <YAxis
                      tickFormatter={(value) => `$${value}`}
                      tickLine={false}
                      axisLine={false}
                      width={58}
                    />
                    <ReferenceLine y={0} stroke="currentColor" strokeWidth={2} />
                    <Tooltip
                      cursor={{ strokeWidth: 2, strokeDasharray: "4 4" }}
                      content={
                        <AnalyticsTooltip playerNames={playerNames} />
                      }
                    />
                    {players.map((player) => {
                      const visible =
                        focusedPlayers.size === 0 || focusedPlayers.has(player.key);
                      return (
                        <Line
                          key={player.key}
                          type="monotone"
                          dataKey={player.seriesKey}
                          name={player.name}
                          stroke={`var(--color-${player.seriesKey})`}
                          strokeWidth={visible ? 4 : 2}
                          strokeOpacity={visible ? 1 : 0.12}
                          dot={visible ? { r: 4, strokeWidth: 2 } : false}
                          activeDot={visible ? { r: 7, strokeWidth: 2 } : false}
                          connectNulls={false}
                        />
                      );
                    })}
                  </LineChart>
                </ChartContainer>
              </>
            ) : (
              <div className="flex h-52 items-center justify-center border-2 border-dashed border-ink bg-muted/40 p-8 text-center font-black uppercase text-muted-foreground">
                Record player balances to unlock the winnings trend.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-4 sm:p-6">
            <h3 className="flex items-center gap-2 text-lg text-foreground">
              <Trophy className="h-5 w-5" strokeWidth={3} />
              Win Rate
            </h3>
            <p className="mb-4 text-sm font-bold text-muted-foreground">
              Wins divided by sessions personally played.
            </p>
            {winRates.length > 0 ? (
              <>
                <ChartContainer
                  config={winRateConfig}
                  className="h-[250px] w-full aspect-auto"
                >
                  <BarChart
                    data={winRates}
                    layout="vertical"
                    margin={{ top: 4, right: 42, left: 6, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="4 4" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="playerName"
                      width={64}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontWeight: 800 }}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))" }}
                      formatter={(value) => [
                        `${Number(value).toFixed(1)}%`,
                        "Win rate",
                      ]}
                      contentStyle={{
                        border: "2px solid hsl(var(--ink))",
                        borderRadius: 0,
                        background: "hsl(var(--popover))",
                        color: "hsl(var(--popover-foreground))",
                        boxShadow: "3px 3px 0 hsl(var(--brutal-shadow))",
                        fontWeight: 700,
                      }}
                    />
                    <Bar
                      dataKey="winRate"
                      fill="var(--color-winRate)"
                      stroke="hsl(var(--ink))"
                      strokeWidth={2}
                    >
                      <LabelList
                        dataKey="winRate"
                        position="right"
                        formatter={(value: number) => `${value.toFixed(0)}%`}
                        className="fill-foreground font-mono font-bold"
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {winRates.map((player) => (
                    <div
                      key={player.key}
                      className="border-2 border-ink bg-muted px-2 py-1 text-center font-mono text-xs font-bold"
                    >
                      <span className="font-sans font-black uppercase">
                        {player.playerName}
                      </span>
                      {" · "}
                      {player.wins}/{player.sessions}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-52 items-center justify-center border-2 border-dashed border-ink bg-muted/40 p-8 text-center font-black uppercase text-muted-foreground">
                Play a session to calculate win rates.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-4 sm:p-6">
            <h3 className="flex items-center gap-2 text-lg text-foreground">
              <Flame className="h-5 w-5 text-destructive" strokeWidth={3} />
              Incident Activity
            </h3>
            <p className="mb-4 flex flex-wrap items-center gap-x-3 text-sm font-bold text-muted-foreground">
              <span className="flex items-center gap-1">
                <Flame className="h-4 w-4 text-destructive" /> Zha Hu
              </span>
              <span className="flex items-center gap-1">
                <Flower2 className="h-4 w-4 text-accent" /> 谢谢 Kai Xiang
              </span>
            </p>
            {hasIncidents ? (
              <ChartContainer
                config={incidentConfig}
                className="h-[290px] w-full aspect-auto"
              >
                <BarChart
                  data={incidentData}
                  margin={{ top: 12, right: 8, left: -18, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tickLine={false}
                    axisLine={{ strokeWidth: 2 }}
                    minTickGap={16}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    formatter={(value, name) => [
                      `${value} ${Number(value) === 1 ? "time" : "times"}`,
                      name === "zhaHu" ? "Zha Hu" : "谢谢 Kai Xiang",
                    ]}
                    labelFormatter={(label) => `Session: ${label}`}
                    contentStyle={{
                      border: "2px solid hsl(var(--ink))",
                      borderRadius: 0,
                      background: "hsl(var(--popover))",
                      color: "hsl(var(--popover-foreground))",
                      boxShadow: "3px 3px 0 hsl(var(--brutal-shadow))",
                      fontWeight: 700,
                    }}
                  />
                  <Bar
                    dataKey="zhaHu"
                    fill="var(--color-zhaHu)"
                    stroke="hsl(var(--ink))"
                    strokeWidth={2}
                  />
                  <Bar
                    dataKey="xieXie"
                    fill="var(--color-xieXie)"
                    stroke="hsl(var(--ink))"
                    strokeWidth={2}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-52 items-center justify-center border-2 border-dashed border-ink bg-muted/40 p-8 text-center font-black uppercase text-muted-foreground">
                Incident counts will appear after they are recorded.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}