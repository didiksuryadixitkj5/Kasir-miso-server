import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, PageHeader, Screen, Surface } from '@/components/WarungUI';
import { NoteCategory, useNotes } from '@/context/NotesContext';
import { useColors } from '@/hooks/useColors';

const categoryOptions: Array<{ id: NoteCategory; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; helper: string }> = [
  { id: 'shopping', label: 'Belanja besok', icon: 'cart-outline', helper: 'Yang perlu dibeli untuk operasional besok.' },
  { id: 'carry', label: 'Perlu dibawa', icon: 'bag-handle-outline', helper: 'Barang yang harus dibawa saat berangkat.' },
  { id: 'general', label: 'Catatan biasa', icon: 'create-outline', helper: 'Catatan bebas untuk hal-hal penting.' },
];
const unitOptions = ['pcs', 'kg', 'liter', 'pack'];

export default function NotesScreen() {
  const c = useColors();
  const { notes, addNote, addShoppingItem, toggleNote, deleteNote, changeShoppingQuantity, clearCompleted } = useNotes();
  const [selected, setSelected] = useState<NoteCategory>('shopping');
  const [draft, setDraft] = useState('');
  const [shoppingName, setShoppingName] = useState('');
  const [shoppingQuantity, setShoppingQuantity] = useState('1');
  const [shoppingUnit, setShoppingUnit] = useState('pcs');
  const option = categoryOptions.find((item) => item.id === selected) ?? categoryOptions[0];
  const activeNotes = notes[selected];
  const completedCount = activeNotes.filter((item) => item.done).length;
  const pendingNotes = useMemo(() => activeNotes.filter((item) => !item.done), [activeNotes]);
  const completedNotes = useMemo(() => activeNotes.filter((item) => item.done), [activeNotes]);

  const submit = () => {
    if (!draft.trim()) return;
    addNote(selected, draft);
    setDraft('');
  };

  const submitShopping = () => {
    const quantity = Number.parseFloat(shoppingQuantity.replace(',', '.'));
    if (!shoppingName.trim() || !Number.isFinite(quantity) || quantity <= 0) return;
    addShoppingItem(shoppingName, quantity, shoppingUnit);
    setShoppingName('');
    setShoppingQuantity('1');
  };

  return (
    <Screen>
      <PageHeader
        eyebrow="Ruang catatan"
        title="Catatan"
        subtitle="Simpan hal kecil yang membantu warung berjalan lebih lancar."
      />

      <View style={s.categoryTabs}>
        {categoryOptions.map((item) => {
          const active = item.id === selected;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setSelected(item.id)}
              style={({ pressed }) => [
                s.categoryTab,
                {
                  backgroundColor: active ? c.primary : c.card,
                  borderColor: active ? c.primary : c.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <Ionicons name={item.icon} size={17} color={active ? c.primaryForeground : c.mutedForeground} />
              <Text style={[s.categoryTabText, { color: active ? c.primaryForeground : c.mutedForeground }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {selected === 'shopping' ? (
        <ShoppingContent
          items={activeNotes}
          name={shoppingName}
          quantity={shoppingQuantity}
          unit={shoppingUnit}
          onNameChange={setShoppingName}
          onQuantityChange={setShoppingQuantity}
          onUnitChange={setShoppingUnit}
          onSubmit={submitShopping}
          onToggle={toggleNote}
          onDelete={deleteNote}
          onChangeQuantity={changeShoppingQuantity}
          onClear={() => clearCompleted('shopping')}
        />
      ) : (
      <>
      <View style={s.sectionHeading}>
        <View style={s.sectionCopy}>
          <Text style={[s.sectionTitle, { color: c.foreground }]}>{option.label}</Text>
          <Text style={[s.sectionHelper, { color: c.mutedForeground }]}>{option.helper}</Text>
        </View>
        {completedCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bersihkan catatan selesai"
            onPress={() => clearCompleted(selected)}
            style={({ pressed }) => [s.clearButton, { borderColor: c.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Text style={[s.clearButtonText, { color: c.primary }]}>Bersihkan selesai</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[s.composer, { backgroundColor: c.card, borderColor: c.border }]}>
        <TextInput
          testID="note-input"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={selected === 'carry' ? 'Contoh: bawa nota titipan' : 'Tulis catatan baru'}
          placeholderTextColor={c.mutedForeground}
          returnKeyType="done"
          style={[s.input, { color: c.foreground }]}
          accessibilityLabel={`Tambah ${option.label.toLowerCase()}`}
        />
        <Pressable
          testID="add-note"
          accessibilityRole="button"
          accessibilityLabel={`Tambah ke ${option.label}`}
          onPress={submit}
          disabled={!draft.trim()}
          style={({ pressed }) => [s.addButton, { backgroundColor: draft.trim() ? c.primary : c.muted, opacity: pressed ? 0.72 : 1 }]}
        >
          <Ionicons name="arrow-up" size={19} color={draft.trim() ? c.primaryForeground : c.mutedForeground} />
        </Pressable>
      </View>

      {pendingNotes.length ? (
        <View style={s.noteList}>
          {pendingNotes.map((item) => (
            <NoteRow key={item.id} item={item} category={selected} onToggle={toggleNote} onDelete={deleteNote} />
          ))}
        </View>
      ) : (
        <EmptyState
          icon={option.icon}
          title={selected === 'carry' ? 'Belum ada barang bawaan' : 'Belum ada catatan'}
          body="Tambahkan catatan di kolom atas supaya tidak terlewat."
        />
      )}

      {completedNotes.length ? (
        <View style={s.completedSection}>
          <Text style={[s.completedLabel, { color: c.mutedForeground }]}>SUDAH SELESAI · {completedNotes.length}</Text>
          {completedNotes.map((item) => (
            <NoteRow key={item.id} item={item} category={selected} onToggle={toggleNote} onDelete={deleteNote} />
          ))}
        </View>
      ) : null}
      </>
      )}
    </Screen>
  );
}

function ShoppingContent({
  items,
  name,
  quantity,
  unit,
  onNameChange,
  onQuantityChange,
  onUnitChange,
  onSubmit,
  onToggle,
  onDelete,
  onChangeQuantity,
  onClear,
}: {
  items: Array<{ id: string; text: string; done: boolean; quantity?: number; unit?: string }>;
  name: string;
  quantity: string;
  unit: string;
  onNameChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onUnitChange: (value: string) => void;
  onSubmit: () => void;
  onToggle: (category: NoteCategory, id: string) => void;
  onDelete: (category: NoteCategory, id: string) => void;
  onChangeQuantity: (id: string, delta: number) => void;
  onClear: () => void;
}) {
  const c = useColors();
  const completed = items.filter((item) => item.done);
  const pending = items.filter((item) => !item.done);
  const progress = items.length ? completed.length / items.length : 0;
  const canSubmit = name.trim().length > 0 && Number.parseFloat(quantity.replace(',', '.')) > 0;

  return (
    <>
      <View style={[s.shoppingSummary, { backgroundColor: c.foreground }]}>
        <View style={s.shoppingSummaryTop}>
          <View style={s.shoppingSummaryIcon}>
            <Ionicons name="basket-outline" size={21} color={c.primaryForeground} />
          </View>
          <View style={s.shoppingSummaryCopy}>
            <Text style={[s.shoppingSummaryKicker, { color: c.primaryForeground + 'B8' }]}>Rencana besok</Text>
            <Text style={[s.shoppingSummaryTitle, { color: c.card }]}>Daftar belanja</Text>
          </View>
          <Text style={[s.shoppingSummaryCount, { color: c.primaryForeground }]}>{completed.length}/{items.length}</Text>
        </View>
        <View style={[s.progressTrack, { backgroundColor: c.primaryForeground + '30' }]}>
          <View style={[s.progressFill, { backgroundColor: c.primaryForeground, width: `${progress * 100}%` }]} />
        </View>
        <Text style={[s.shoppingSummaryHint, { color: c.primaryForeground + 'B8' }]}>
          {items.length ? (completed.length === items.length ? 'Semua kebutuhan sudah dibeli.' : `${pending.length} barang masih perlu dibeli.`) : 'Catat kebutuhan warung sebelum berangkat.'}
        </Text>
      </View>

      <View style={[s.shoppingComposer, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={s.shoppingInputRow}>
          <Ionicons name="add-circle-outline" size={19} color={c.primary} />
          <TextInput
            testID="shopping-name-input"
            value={name}
            onChangeText={onNameChange}
            onSubmitEditing={onSubmit}
            placeholder="Nama barang, misalnya minyak goreng"
            placeholderTextColor={c.mutedForeground}
            returnKeyType="done"
            style={[s.shoppingNameInput, { color: c.foreground }]}
            accessibilityLabel="Nama barang belanja"
          />
        </View>
        <View style={s.shoppingFormBottom}>
          <View style={[s.quantityControl, { backgroundColor: c.secondary }]}>
            <TextInput
              testID="shopping-quantity-input"
              value={quantity}
              onChangeText={onQuantityChange}
              keyboardType="decimal-pad"
              selectTextOnFocus
              style={[s.quantityInput, { color: c.foreground }]}
              accessibilityLabel="Jumlah barang"
            />
            <Text style={[s.quantityUnitLabel, { color: c.mutedForeground }]}>{unit}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.unitScroll} contentContainerStyle={s.unitChips}>
            {unitOptions.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="radio"
                accessibilityState={{ selected: unit === item }}
                onPress={() => onUnitChange(item)}
                style={({ pressed }) => [s.unitChip, { backgroundColor: unit === item ? c.primary : c.secondary, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[s.unitChipText, { color: unit === item ? c.primaryForeground : c.mutedForeground }]}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            testID="add-shopping-item"
            accessibilityRole="button"
            accessibilityLabel="Tambah barang belanja"
            onPress={onSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [s.shoppingAddButton, { backgroundColor: canSubmit ? c.primary : c.muted, opacity: pressed ? 0.72 : 1 }]}
          >
            <Ionicons name="arrow-up" size={18} color={canSubmit ? c.primaryForeground : c.mutedForeground} />
          </Pressable>
        </View>
      </View>

      {pending.length ? (
        <View style={s.shoppingList}>
          {pending.map((item) => (
            <ShoppingRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} onChangeQuantity={onChangeQuantity} />
          ))}
        </View>
      ) : (
        <EmptyState
          icon="checkmark-done-outline"
          title={items.length ? 'Belanja sudah beres' : 'Mulai daftar belanja'}
          body={items.length ? 'Semua barang di daftar ini sudah ditandai dibeli.' : 'Tambahkan barang dan jumlahnya agar persiapan besok lebih teratur.'}
        />
      )}

      {completed.length ? (
        <View style={s.completedSection}>
          <View style={s.completedHeading}>
            <Text style={[s.completedLabel, { color: c.mutedForeground }]}>SUDAH DIBELI · {completed.length}</Text>
            <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="Hapus barang yang sudah dibeli">
              <Text style={[s.clearButtonText, { color: c.primary }]}>Bersihkan</Text>
            </Pressable>
          </View>
          {completed.map((item) => (
            <ShoppingRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} onChangeQuantity={onChangeQuantity} />
          ))}
        </View>
      ) : null}
    </>
  );
}

function ShoppingRow({
  item,
  onToggle,
  onDelete,
  onChangeQuantity,
}: {
  item: { id: string; text: string; done: boolean; quantity?: number; unit?: string };
  onToggle: (category: NoteCategory, id: string) => void;
  onDelete: (category: NoteCategory, id: string) => void;
  onChangeQuantity: (id: string, delta: number) => void;
}) {
  const c = useColors();
  return (
    <Surface style={s.shoppingRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.done ? `Tandai ${item.text} belum dibeli` : `Tandai ${item.text} sudah dibeli`}
        onPress={() => onToggle('shopping', item.id)}
        style={({ pressed }) => [s.shoppingCheck, { backgroundColor: item.done ? c.primary : c.secondary, borderColor: item.done ? c.primary : c.border, opacity: pressed ? 0.7 : 1 }]}
      >
        {item.done ? <Ionicons name="checkmark" size={16} color={c.primaryForeground} /> : null}
      </Pressable>
      <View style={s.shoppingRowCopy}>
        <Text style={[s.shoppingRowName, { color: item.done ? c.mutedForeground : c.foreground, textDecorationLine: item.done ? 'line-through' : 'none' }]}>{item.text}</Text>
        <Text style={[s.shoppingRowMeta, { color: c.mutedForeground }]}>{item.quantity ?? 1} {item.unit ?? 'pcs'}</Text>
      </View>
      {!item.done ? (
        <View style={[s.stepper, { backgroundColor: c.secondary }]}>
          <Pressable onPress={() => onChangeQuantity(item.id, -1)} hitSlop={6} accessibilityLabel={`Kurangi jumlah ${item.text}`}>
            <Ionicons name="remove" size={15} color={c.mutedForeground} />
          </Pressable>
          <Text style={[s.stepperValue, { color: c.foreground }]}>{item.quantity ?? 1}</Text>
          <Pressable onPress={() => onChangeQuantity(item.id, 1)} hitSlop={6} accessibilityLabel={`Tambah jumlah ${item.text}`}>
            <Ionicons name="add" size={15} color={c.primary} />
          </Pressable>
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${item.text}`} onPress={() => onDelete('shopping', item.id)} hitSlop={8} style={s.deleteButton}>
        <Ionicons name="trash-outline" size={17} color={c.mutedForeground} />
      </Pressable>
    </Surface>
  );
}

function NoteRow({
  item,
  category,
  onToggle,
  onDelete,
}: {
  item: { id: string; text: string; done: boolean };
  category: NoteCategory;
  onToggle: (category: NoteCategory, id: string) => void;
  onDelete: (category: NoteCategory, id: string) => void;
}) {
  const c = useColors();
  return (
    <Surface style={s.noteRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.done ? `Tandai ${item.text} belum selesai` : `Tandai ${item.text} selesai`}
        onPress={() => onToggle(category, item.id)}
        style={({ pressed }) => [s.checkButton, { backgroundColor: item.done ? c.primary : c.secondary, opacity: pressed ? 0.72 : 1 }]}
      >
        {item.done ? <Ionicons name="checkmark" size={16} color={c.primaryForeground} /> : null}
      </Pressable>
      <Text style={[s.noteText, { color: item.done ? c.mutedForeground : c.foreground, textDecorationLine: item.done ? 'line-through' : 'none' }]}>{item.text}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Hapus ${item.text}`}
        onPress={() => onDelete(category, item.id)}
        hitSlop={8}
        style={({ pressed }) => [s.deleteButton, { opacity: pressed ? 0.55 : 1 }]}
      >
        <Ionicons name="trash-outline" size={17} color={c.mutedForeground} />
      </Pressable>
    </Surface>
  );
}

const s = StyleSheet.create({
  categoryTabs: { flexDirection: 'row', gap: 7, marginBottom: 18 },
  categoryTab: { flex: 1, minHeight: 54, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, gap: 3 },
  categoryTabText: { fontSize: 10, fontWeight: '800', textAlign: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 11 },
  sectionCopy: { flex: 1 },
  sectionTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  sectionHelper: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  clearButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  clearButtonText: { fontSize: 10, fontWeight: '800' },
  shoppingSummary: { borderRadius: 22, padding: 16, marginBottom: 12 },
  shoppingSummaryTop: { flexDirection: 'row', alignItems: 'center' },
  shoppingSummaryIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  shoppingSummaryCopy: { flex: 1, marginLeft: 10 },
  shoppingSummaryKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  shoppingSummaryTitle: { fontSize: 19, fontWeight: '800', marginTop: 2 },
  shoppingSummaryCount: { fontSize: 17, fontWeight: '800' },
  progressTrack: { height: 7, borderRadius: 6, overflow: 'hidden', marginTop: 15 },
  progressFill: { height: '100%', borderRadius: 6 },
  shoppingSummaryHint: { fontSize: 11, marginTop: 8 },
  shoppingComposer: { borderWidth: 1, borderRadius: 19, padding: 12, marginBottom: 13 },
  shoppingInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shoppingNameInput: { flex: 1, minHeight: 34, fontSize: 13, fontWeight: '600' },
  shoppingFormBottom: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  quantityControl: { height: 37, minWidth: 62, borderRadius: 11, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9 },
  quantityInput: { minWidth: 25, padding: 0, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  quantityUnitLabel: { fontSize: 10, fontWeight: '700', marginLeft: 3 },
  unitScroll: { flex: 1, flexShrink: 1 },
  unitChips: { flexDirection: 'row', gap: 4 },
  unitChip: { height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  unitChipText: { fontSize: 9, fontWeight: '800' },
  shoppingAddButton: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shoppingList: { gap: 9 },
  shoppingRow: { minHeight: 70, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  shoppingCheck: { width: 26, height: 26, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  shoppingRowCopy: { flex: 1 },
  shoppingRowName: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  shoppingRowMeta: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  stepper: { height: 30, borderRadius: 9, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperValue: { minWidth: 17, textAlign: 'center', fontSize: 11, fontWeight: '800' },
  composer: { minHeight: 54, borderWidth: 1, borderRadius: 16, paddingLeft: 14, paddingRight: 7, flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  input: { flex: 1, minHeight: 48, fontSize: 13 },
  addButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  noteList: { gap: 9 },
  noteRow: { minHeight: 62, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkButton: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  noteText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  deleteButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  completedSection: { marginTop: 24, gap: 9 },
  completedHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  completedLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 1 },
});