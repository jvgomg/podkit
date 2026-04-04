import React from 'react';
import sickpodImg from '../../assets/sickpod.png';
import './SickPodScreen.css';

export interface SickPodScreenProps {
  message: string;
}

export function SickPodScreen({ message }: SickPodScreenProps) {
  return (
    <div className="sickpod-screen">
      <img
        className="sickpod-screen__image"
        src={sickpodImg}
        alt="Sick iPod"
        width={64}
        height={64}
      />
      <p className="sickpod-screen__message">{message}</p>
    </div>
  );
}
