import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dcb.eventmanager',
  appName: 'DCB Event Manager',
  webDir: 'dist',
  android: {
    backgroundColor: '#060a13',
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060a13',
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#060a13',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
};

export default config;
