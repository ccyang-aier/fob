import type { RefObject } from 'react';
import { Star } from 'lucide-react';
import styles from './companion-character.module.css';

export function CompanionCharacter({ sceneRef }: {
  sceneRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={sceneRef} className={styles.character}>
      <div className={styles['stage']}>
        <div className={styles['shadow']} />
        <div className={styles['hop']}>
          <div className={styles['squash']}><div className={styles['tilt']}><div className={styles['breath']}>
            <canvas className={styles['body-svg']} aria-hidden />
            <span className={styles['burst-line'] + ' ' + styles['l']} aria-hidden>(</span><span className={styles['burst-line'] + ' ' + styles['r']} aria-hidden>)</span>
            <div className={styles['blush'] + ' ' + styles['l']} /><div className={styles['blush'] + ' ' + styles['r']} />
            <div className={styles['face']} aria-hidden>
              <div className={styles['eye']}><div className={styles['ball']}><div className={styles['pupil']} /><div className={styles['lid']} /></div><div className={styles['arc'] + ' ' + styles['down']} /><div className={styles['arc'] + ' ' + styles['up']} /></div>
              <div className={styles['eye']}><div className={styles['ball']}><div className={styles['pupil']} /><div className={styles['lid']} /></div><div className={styles['arc'] + ' ' + styles['down']} /><div className={styles['arc'] + ' ' + styles['up']} /></div>
            </div>
            <span className={styles.sleepMarks} aria-hidden><span className={styles.zzz}>z</span><span className={styles.zzz}>z</span><span className={styles.zzz}>Z</span></span>
          </div></div></div>
          <div className={styles.dizzyStars} aria-hidden>
            {[0, 1, 2].map(index => <span className={styles.starOrbit} key={index}><Star size={30} fill="currentColor" strokeWidth={1.5} /></span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
