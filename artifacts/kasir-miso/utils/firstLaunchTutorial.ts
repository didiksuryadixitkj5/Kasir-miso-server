import AsyncStorage from '@react-native-async-storage/async-storage';

export const FIRST_LAUNCH_TUTORIAL_KEY = 'kasir-miso:first-launch-tutorial-completed';

export async function hasCompletedFirstLaunchTutorial(): Promise<boolean> {
  return (await AsyncStorage.getItem(FIRST_LAUNCH_TUTORIAL_KEY)) === 'true';
}

export function completeFirstLaunchTutorial(): Promise<void> {
  return AsyncStorage.setItem(FIRST_LAUNCH_TUTORIAL_KEY, 'true');
}