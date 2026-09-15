'use client';

import type { ReactNode } from 'react';
import { AppConfigProvider } from './AppConfigProvider';
import { AuthProvider } from './AuthProvider';
import { RepositoryProvider } from './RepositoryProvider';
import { SignInGate } from './SignInGate';
import { useGlobalRipple } from './useRipple';
import { ThemeSync } from './useTheme';
import { useTooltips } from './useTooltips';

export function AppProviders({ children }: { children: ReactNode }) {
  // Mounted once, above every screen: the press feedback belongs to the app
  // rather than to any one control.
  useGlobalRipple();
  useTooltips();

  return (
    <AppConfigProvider>
      {/* The theme follows the stored choice — or the system, live — on every
          screen, the sign-in page included, not only where the editor mounts. */}
      <ThemeSync />
      <AuthProvider>
        <RepositoryProvider>
          <SignInGate>{children}</SignInGate>
        </RepositoryProvider>
      </AuthProvider>
    </AppConfigProvider>
  );
}
