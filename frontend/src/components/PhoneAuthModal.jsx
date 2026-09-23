import React, { useState } from 'react';
import { X, Smartphone, CheckCircle, ShieldCheck } from 'lucide-react';

export default function PhoneAuthModal({ isOpen, onClose }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(1); // 1: Phone, 2: OTP, 3: Success
  const [variety, setVariety] = useState('Thompson Seedless');

  if (!isOpen) return null;

  const handleSendOtp = (e) => {
    e.preventDefault();
    if (phone.length >= 10) {
      setStep(2);
    }
  };

  const handleVerifyOtp = (e) => {
    e.preventDefault();
    if (otp.length === 4) {
      setStep(3);
      setTimeout(() => {
        onClose();
        setStep(1);
        setPhone('');
        setOtp('');
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="glass-card w-full max-w-md rounded-2xl p-6 border border-emerald-500/40 relative shadow-2xl">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Farmer Profile Login</h3>
            <p className="text-xs text-slate-400">Save diagnosis history & grape farm details</p>
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile Number</label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5">
                <span className="text-xs text-slate-400 mr-2 font-bold">+91</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter 10-digit mobile number"
                  maxLength={10}
                  className="bg-transparent text-white text-sm focus:outline-none flex-1"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Primary Grape Variety Grown</label>
              <select
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none"
              >
                <option value="Thompson Seedless">Thompson Seedless</option>
                <option value="Manik Chaman">Manik Chaman</option>
                <option value="Sharad Seedless">Sharad Seedless</option>
                <option value="Flame Seedless">Flame Seedless</option>
                <option value="Bangalore Blue">Bangalore Blue</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={phone.length < 10}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-950/40 disabled:opacity-40 transition-all"
            >
              Get Verification Code (OTP)
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-xs text-slate-300">
              Enter 4-digit code sent to <span className="font-bold text-emerald-400">+91 {phone}</span>:
            </p>

            <div className="flex justify-center gap-2">
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="1 2 3 4"
                maxLength={4}
                className="bg-slate-900 border border-emerald-500/50 rounded-xl px-4 py-3 text-center text-lg font-mono tracking-widest text-emerald-300 focus:outline-none"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={otp.length < 4}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold text-xs shadow-lg disabled:opacity-40 transition-all"
            >
              Verify OTP & Sign In
            </button>
          </form>
        )}

        {step === 3 && (
          <div className="py-6 text-center space-y-2">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto animate-bounce" />
            <h4 className="text-base font-bold text-white">Farmer Profile Verified!</h4>
            <p className="text-xs text-slate-400">Welcome, farmer profile synced with Grape Master.</p>
          </div>
        )}

      </div>
    </div>
  );
}
