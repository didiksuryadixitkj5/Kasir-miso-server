import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type NoteCategory = 'shopping' | 'carry' | 'general';

export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

type NotesState = Record<NoteCategory, NoteItem[]>;

interface NotesContextValue {
  notes: NotesState;
  hydrated: boolean;
  addNote: (category: NoteCategory, text: string) => void;
  toggleNote: (category: NoteCategory, id: string) => void;
  deleteNote: (category: NoteCategory, id: string) => void;
  clearCompleted: (category: NoteCategory) => void;
}

const NOTES_STORAGE_KEY = 'kasir-miso-notes-v1';
const createEmptyNotes = (): NotesState => ({ shopping: [], carry: [], general: [] });
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const NotesContext = createContext<NotesContextValue | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<NotesState>(createEmptyNotes);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(NOTES_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<NotesState>;
        if (!mounted) return;
        setNotes({
          shopping: Array.isArray(parsed.shopping) ? parsed.shopping : [],
          carry: Array.isArray(parsed.carry) ? parsed.carry : [],
          general: Array.isArray(parsed.general) ? parsed.general : [],
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated) void AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  }, [hydrated, notes]);

  const value = useMemo<NotesContextValue>(() => ({
    notes,
    hydrated,
    addNote: (category, text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setNotes((current) => ({
        ...current,
        [category]: [{ id: makeId(), text: trimmed, done: false, createdAt: new Date().toISOString() }, ...current[category]],
      }));
    },
    toggleNote: (category, id) => {
      setNotes((current) => ({
        ...current,
        [category]: current[category].map((item) => item.id === id ? { ...item, done: !item.done } : item),
      }));
    },
    deleteNote: (category, id) => {
      setNotes((current) => ({
        ...current,
        [category]: current[category].filter((item) => item.id !== id),
      }));
    },
    clearCompleted: (category) => {
      setNotes((current) => ({
        ...current,
        [category]: current[category].filter((item) => !item.done),
      }));
    },
  }), [hydrated, notes]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const context = useContext(NotesContext);
  if (!context) throw new Error('useNotes harus dipakai di dalam NotesProvider');
  return context;
}