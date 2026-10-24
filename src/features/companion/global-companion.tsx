'use client';

import dynamic from 'next/dynamic';

const CompanionWidget = dynamic(() => import('./companion-widget').then(module => module.CompanionWidget), { ssr: false });

export function GlobalCompanion() { return <CompanionWidget />; }
