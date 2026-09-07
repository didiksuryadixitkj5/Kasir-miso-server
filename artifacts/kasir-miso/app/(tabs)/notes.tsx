import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, PageHeader, Screen, Surface } from '@/components/WarungUI';
import { NoteCategory, useNotes } from '@/context/NotesContext';
import { useColors } from '@/hooks/useColors';

const categoryOptions: Array<{ id: NoteCategory; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; helper: string }> = [
  { id: 'shopping', label: 'Belanja besok', icon: 'cart-outline', helper: 'Yang perlu dibeli untuk operasional besok.' },
  { id: 'carry', label: 'Perlu dibawa', icon: 'bag-handle-outline', helper: 'Barang yang harus dibawa saat berangkat.' },
  { id: 'general', label: 'Catatan biasa', icon: 'create-outline', helper: 'Catatan bebas untuk hal-hal penting.' },
];

export default function NotesScreen() {
  const c = useColors();
  const { notes, addNote, toggleNote, deleteNote, clearCompleted } = useNotes();
  const [selected, setSelected] = useState<NoteCategory>('shopping');
  const [draft, setDraft] = useState('');
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
          placeholder={selected === 'shopping' ? 'Contoh: beli minyak goreng' : selected === 'carry' ? 'Contoh: bawa nota titipan' : 'Tulis catatan baru'}
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
          title={selected === 'shopping' ? 'Belum ada daftar belanja' : selected === 'carry' ? 'Belum ada barang bawaan' : 'Belum ada catatan'}
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
    </Screen>
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
  composer: { minHeight: 54, borderWidth: 1, borderRadius: 16, paddingLeft: 14, paddingRight: 7, flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  input: { flex: 1, minHeight: 48, fontSize: 13 },
  addButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  noteList: { gap: 9 },
  noteRow: { minHeight: 62, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkButton: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  noteText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  deleteButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  completedSection: { marginTop: 24, gap: 9 },
  completedLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 1 },
});