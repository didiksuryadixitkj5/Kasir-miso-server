import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, PrimaryButton, Screen, Surface, ThemeActions } from '@/components/WarungUI';
import { themeOptions } from '@/constants/colors';
import { useColors } from '@/hooks/useColors';
import { useTheme } from '@/context/ThemeContext';
import { useGoogleAccount, type GoogleClientIds } from '@/context/GoogleAccountContext';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function SettingRow({
  icon,
  label,
  detail,
  onPress,
  selected = false,
  testID,
}: {
  icon: IconName;
  label: string;
  detail: string;
  onPress: () => void;
  selected?: boolean;
  testID?: string;
}) {
  const c = useColors();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        s.settingRow,
        {
          backgroundColor: selected ? c.secondary : c.card,
          borderColor: selected ? c.primary : c.border,
          opacity: pressed ? 0.68 : 1,
        },
      ]}
    >
      <View style={[s.settingIcon, { backgroundColor: selected ? c.primary : c.muted }]}>
        <Ionicons name={icon} size={20} color={selected ? c.primaryForeground : c.mutedForeground} />
      </View>
      <View style={s.settingCopy}>
        <Text style={[s.settingLabel, { color: c.foreground }]}>{label}</Text>
        <Text style={[s.settingDetail, { color: c.mutedForeground }]}>{detail}</Text>
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={22} color={c.primary} /> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const c = useColors();
  const router = useRouter();
  const { mode, themeId, selectTheme, toggleMode } = useTheme();
  const { googleClientIds, saveGoogleClientIds, clientIdsComplete } = useGoogleAccount();
  const [clientIdDraft, setClientIdDraft] = React.useState<GoogleClientIds>(googleClientIds);
  const [savedClientIds, setSavedClientIds] = React.useState(false);

  React.useEffect(() => {
    setClientIdDraft(googleClientIds);
  }, [googleClientIds]);

  const updateClientId = (platform: keyof GoogleClientIds, value: string) => {
    setSavedClientIds(false);
    setClientIdDraft((current) => ({ ...current, [platform]: value }));
  };

  return (
    <Screen>
      <PageHeader
        eyebrow="Preferensi aplikasi"
        title="Pengaturan"
        subtitle="Atur tampilan Kasir Miso sesuai kebiasaanmu."
        action={
          <View style={s.headerActions}>
            <Pressable
              accessibilityLabel="Kembali ke Lainnya"
              hitSlop={10}
              onPress={() => router.back()}
              style={({ pressed }) => [s.backButton, { backgroundColor: c.primaryForeground, opacity: pressed ? 0.72 : 1 }]}
            >
              <Ionicons name="arrow-back" size={20} color={c.primary} />
            </Pressable>
            <ThemeActions />
          </View>
        }
      />

      <View style={s.section}>
        <Text style={[s.sectionKicker, { color: c.primary }]}>TAMPILAN</Text>
        <Text style={[s.sectionTitle, { color: c.foreground }]}>Tema warna</Text>
        <Text style={[s.sectionBody, { color: c.mutedForeground }]}>
          Pilih warna utama yang digunakan di seluruh aplikasi.
        </Text>
        <View style={s.themeList}>
          {themeOptions.map((option) => (
            <Pressable
              key={option.id}
              testID={`theme-option-${option.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: option.id === themeId }}
              accessibilityLabel={`Tema ${option.label}`}
              onPress={() => selectTheme(option.id)}
              style={({ pressed }) => [
                s.themeOption,
                {
                  backgroundColor: option.id === themeId ? c.secondary : c.card,
                  borderColor: option.id === themeId ? c.primary : c.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={[s.themeSwatch, { backgroundColor: option.swatch }]}>
                {option.id === themeId ? <Ionicons name="checkmark" size={19} color={c.primaryForeground} /> : null}
              </View>
              <View style={s.settingCopy}>
                <Text style={[s.settingLabel, { color: c.foreground }]}>{option.label}</Text>
                <Text style={[s.settingDetail, { color: c.mutedForeground }]}>{option.description}</Text>
              </View>
              {option.id === themeId ? <Ionicons name="checkmark-circle" size={21} color={c.primary} /> : null}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.section}>
        <Text style={[s.sectionKicker, { color: c.primary }]}>AKUN GOOGLE</Text>
        <Text style={[s.sectionTitle, { color: c.foreground }]}>Client ID Google</Text>
        <Text style={[s.sectionBody, { color: c.mutedForeground }]}>
          Masukkan tiga kode dari Google Cloud agar login dan backup Drive bisa dipakai di web, Android, dan iOS.
        </Text>
        <Surface style={s.googleCard}>
          <ClientIdField
            label="Google Web"
            placeholder="1234567890-abc.apps.googleusercontent.com"
            value={clientIdDraft.web}
            onChangeText={(value) => updateClientId('web', value)}
          />
          <ClientIdField
            label="Google Android"
            placeholder="1234567890-abc.apps.googleusercontent.com"
            value={clientIdDraft.android}
            onChangeText={(value) => updateClientId('android', value)}
          />
          <ClientIdField
            label="Google iOS"
            placeholder="1234567890-abc.apps.googleusercontent.com"
            value={clientIdDraft.ios}
            onChangeText={(value) => updateClientId('ios', value)}
          />
          <Text style={[s.googleHint, { color: c.mutedForeground }]}>
            Client ID boleh disimpan di aplikasi. Jangan masukkan Client Secret di sini.
          </Text>
          <PrimaryButton
            icon="save-outline"
            disabled={!clientIdDraft.web.trim() || !clientIdDraft.android.trim() || !clientIdDraft.ios.trim()}
            onPress={() => {
              void saveGoogleClientIds(clientIdDraft).then(() => setSavedClientIds(true));
            }}
            testID="save-google-client-ids"
          >
            Simpan tiga kode
          </PrimaryButton>
          {savedClientIds ? (
            <View style={s.inlineStatus}>
              <Ionicons name="checkmark-circle" size={16} color={c.primary} />
              <Text style={[s.inlineStatusText, { color: c.primary }]}>Tiga kode tersimpan di perangkat ini.</Text>
            </View>
          ) : null}
          {!savedClientIds && clientIdsComplete ? (
            <Text style={[s.googleConfigured, { color: c.primary }]}>Tiga platform sudah terisi.</Text>
          ) : null}
        </Surface>
      </View>

      <View style={s.section}>
        <Text style={[s.sectionKicker, { color: c.primary }]}>MODE TAMPILAN</Text>
        <Text style={[s.sectionTitle, { color: c.foreground }]}>Mode aplikasi</Text>
        <Text style={[s.sectionBody, { color: c.mutedForeground }]}>
          Pilihan mode akan diterapkan dan disimpan otomatis.
        </Text>
        <Surface style={s.modeCard}>
          <SettingRow
            icon="sunny-outline"
            label="Mode terang"
            detail="Tampilan cerah untuk penggunaan siang hari"
            selected={mode === 'light'}
            testID="light-mode-option"
            onPress={() => {
              if (mode !== 'light') toggleMode();
            }}
          />
          <SettingRow
            icon="moon-outline"
            label="Mode gelap"
            detail="Tampilan redup untuk penggunaan malam hari"
            selected={mode === 'dark'}
            testID="dark-mode-option"
            onPress={() => {
              if (mode !== 'dark') toggleMode();
            }}
          />
        </Surface>
      </View>

      <View style={[s.savedNotice, { backgroundColor: c.secondary }]}>
        <Ionicons name="checkmark-circle-outline" size={18} color={c.primary} />
        <Text style={[s.savedNoticeText, { color: c.secondaryForeground }]}>
          Pengaturan tersimpan otomatis di perangkat ini.
        </Text>
      </View>
    </Screen>
  );
}

function ClientIdField({
  label,
  placeholder,
  value,
  onChangeText,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const c = useColors();
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: c.foreground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`Client ID ${label}`}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        style={[s.input, { backgroundColor: c.background, borderColor: c.input, color: c.foreground }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  section: { marginBottom: 23 },
  sectionKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 2 },
  sectionTitle: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  sectionBody: { fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 12 },
  themeList: { gap: 9 },
  themeOption: { minHeight: 62, borderWidth: 1, borderRadius: 15, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  themeSwatch: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  settingCopy: { flex: 1, paddingRight: 8 },
  settingLabel: { fontSize: 14, fontWeight: '800' },
  settingDetail: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  modeCard: { padding: 9, gap: 8 },
  googleCard: { gap: 13 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '800' },
  input: { minHeight: 47, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, fontSize: 12 },
  googleHint: { fontSize: 11, lineHeight: 16, marginTop: -2 },
  inlineStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -3 },
  inlineStatusText: { fontSize: 11, fontWeight: '800' },
  googleConfigured: { fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: -3 },
  settingRow: { minHeight: 66, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  savedNotice: { minHeight: 44, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedNoticeText: { flex: 1, fontSize: 11, fontWeight: '700', lineHeight: 16 },
});