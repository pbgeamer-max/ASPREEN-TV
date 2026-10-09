/**
 * Centralized Branding & Visual Identity for Aspreen TV.
 * Modifying branding here propagates through the entire application without
 * having to manually edit individual pages or components.
 */

export const BRANDING = {
  appName: 'Aspreen TV',
  browserTitle: 'Aspreen TV | Stream Management',
  dashboardTitle: 'Aspreen TV — Streaming Dashboard',
  loginHeading: 'Welcome to Aspreen TV',
  loginSubheading: 'Enter your administrator credentials to access the streaming console.',
  logoText: 'Aspreen TV',
  monogram: 'ATV',
  tagline: 'Private Stream Relay & HLS Transcoding Platform',
  copyrightNotice: '© Aspreen TV. All rights reserved. Private Administration Only.',

  // Strict Monochrome Palette
  colors: {
    mainBg: '#080808',
    sidebarBg: '#0A0A0A',
    secondaryBg: '#0D0D0D',
    cardBg: '#111111',
    elevatedSurface: '#171717',
    inputBg: '#101010',
    border: '#262626',
    secondaryBorder: '#333333',
    primaryText: '#F5F5F5',
    secondaryText: '#A1A1AA',
    mutedText: '#71717A',
    primaryButtonBg: '#FFFFFF',
    primaryButtonText: '#000000',
    secondaryButtonBg: '#1F1F1F',
    secondaryButtonText: '#FFFFFF',
    dangerText: '#E4E4E7', // Muted monochrome danger label
    dangerBorder: '#3F3F46',
  },
} as const;

export type BrandingConfig = typeof BRANDING;
