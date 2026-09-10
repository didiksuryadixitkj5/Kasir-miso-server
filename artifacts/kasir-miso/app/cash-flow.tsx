import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatRp,
  isDateInReportPeriod,
  type ReportPeriod,
  useWarung,
} from '@/context/WarungContext';
import { useColors } from '@/hooks/useColors';
import { Badge, EmptyState, PageHeader, Screen, SectionHeader, Surface } from '@/components/WarungUI';

type FlowKind = 'in' | 'out';
type FlowEntry = {
  id: string;
  kind: FlowKind;
  title: string;
  detail: string;
  amount: number;
  date: string;
};

const periods: ReportPeriod[] = ['Hari ini', 'Minggu ini', 'Bulan ini'];

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function CashFlowScreen() {
  const c = useColors();
  const { sales, expenses } = useWarung();
  const [period, setPeriod] = useState<ReportPeriod>('Hari ini');
  const entries = useMemo<FlowEntry[]>(() => [
    ...sales.map((sale) => ({
      id: `sale-${sale.id}`,
      kind: 'in' as const,
      title: 'Penjualan',
      detail: `${sale.method} · ${sale.items.reduce((sum, item) => sum + item.qty, 0)} item`,
      amount: sale.amount,
      date: sale.date,
    })),
    ...expenses.map((expense) => ({
      id: `expense-${expense.id}`,
      kind: 'out' as const,
      title: expense.title,
      detail: 'Pengeluaran operasional',
      amount: expense.amount,
      date: expense.date,
    })),
  ]
    .filter((entry) => isDateInReportPeriod(entry.date, period))
    .sort((a, b) => b.date.localeCompare(a.date)),
  [expenses, period, sales]);

  const incoming = entries.filter((entry) => entry.kind === 'in').reduce((sum, entry) => sum + entry.amount, 0);
  const outgoing = entries.filter((entry) => entry.kind === 'out').reduce((sum, entry) => sum + entry.amount, 0);
  const balance = incoming - outgoing;

  return (
    <Screen>
      <PageHeader
        eyebrow="Keuangan warung"
        title="Arus kas"
        subtitle="Pantau uang yang masuk, keluar, dan saldo bersih."
        backRoute="/"
      />
      <View style={s.periods}>
        {periods.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === item }}
            onPress={() => setPeriod(item)}
            style={({ pressed }) => [
              s.period,
              {
                backgroundColor: period === item ? c.primary : c.card,
                borderColor: period === item ? c.primary : c.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[s.periodText, { color: period === item ? c.primaryForeground : c.mutedForeground }]}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
      <Surface tone="ink" style={s.balanceCard}>
        <Text style={[s.balanceLabel, { color: c.mutedForeground }]}>SALDO BERSIH · {period.toUpperCase()}</Text>
        <Text style={[s.balance, { color: c.card }]}>{formatRp(balance)}</Text>
        <Text style={[s.balanceCaption, { color: c.mutedForeground }]}>
          {formatRp(incoming)} masuk − {formatRp(outgoing)} keluar
        </Text>
      </Surface>
      <View style={s.metrics}>
        <Surface style={s.metric}>
          <View style={[s.metricIcon, { backgroundColor: c.secondary }]}>
            <Ionicons name="arrow-down-outline" size={19} color={c.primary} />
          </View>
          <Text style={[s.metricLabel, { color: c.mutedForeground }]}>Uang masuk</Text>
          <Text style={[s.metricValue, { color: c.foreground }]}>{formatRp(incoming)}</Text>
        </Surface>
        <Surface style={s.metric}>
          <View style={[s.metricIcon, { backgroundColor: c.accent }]}>
            <Ionicons name="arrow-up-outline" size={19} color={c.accentForeground} />
          </View>
          <Text style={[s.metricLabel, { color: c.mutedForeground }]}>Uang keluar</Text>
          <Text style={[s.metricValue, { color: c.foreground }]}>{formatRp(outgoing)}</Text>
        </Surface>
      </View>
      <SectionHeader title="Rincian arus kas" meta={`${entries.length} catatan`} icon="list-outline" />
      {!entries.length ? (
        <EmptyState
          icon="swap-vertical-outline"
          title="Belum ada arus kas"
          body={`Penjualan dan pengeluaran pada periode ${period.toLowerCase()} akan muncul di sini.`}
        />
      ) : (
        entries.map((entry) => (
          <Surface key={entry.id} style={s.entry}>
            <View style={[s.entryIcon, { backgroundColor: entry.kind === 'in' ? c.secondary : c.accent }]}>
              <Ionicons
                name={entry.kind === 'in' ? 'arrow-down-outline' : 'arrow-up-outline'}
                size={19}
                color={entry.kind === 'in' ? c.primary : c.accentForeground}
              />
            </View>
            <View style={s.entryCopy}>
              <Text style={[s.entryTitle, { color: c.foreground }]}>{entry.title}</Text>
              <Text style={[s.entryDetail, { color: c.mutedForeground }]}>
                {formatDate(entry.date)} · {entry.detail}
              </Text>
            </View>
            <View style={s.entryAmount}>
              <Text style={[s.amount, { color: entry.kind === 'in' ? c.primary : c.destructive }]}>
                {entry.kind === 'in' ? '+' : '−'}{formatRp(entry.amount)}
              </Text>
              <Badge tone={entry.kind === 'in' ? 'primary' : 'danger'}>
                {entry.kind === 'in' ? 'Masuk' : 'Keluar'}
              </Badge>
            </View>
          </Surface>
        ))
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  periods: { flexDirection: 'row', gap: 7, marginBottom: 16 },
  period: { borderWidth: 1, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 13 },
  periodText: { fontSize: 11, fontWeight: '800' },
  balanceCard: { marginBottom: 12 },
  balanceLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  balance: { fontSize: 30, fontWeight: '700', marginTop: 8 },
  balanceCaption: { fontSize: 11, marginTop: 7 },
  metrics: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  metric: { flex: 1, minHeight: 118 },
  metricIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  metricLabel: { fontSize: 11, marginTop: 12 },
  metricValue: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  entry: { minHeight: 73, padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  entryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  entryCopy: { flex: 1, paddingRight: 8 },
  entryTitle: { fontSize: 14, fontWeight: '800' },
  entryDetail: { fontSize: 11, marginTop: 4 },
  entryAmount: { alignItems: 'flex-end', gap: 5 },
  amount: { fontSize: 12, fontWeight: '800' },
});