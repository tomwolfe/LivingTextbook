import React from 'react';

const ControlPanel = ({ settings, setSettings, onGenerate, loading }) => {
  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: name === 'level' ? value : parseFloat(value)
    }));
  };

  return (
    <div className="control-panel">
      <div className="input-group">
        <label>What do you want to learn about?</label>
        <input 
          type="text" 
          name="subject"
          placeholder="e.g., How black holes work" 
          value={settings.subject}
          onChange={(e) => setSettings(prev => ({ ...prev, subject: e.target.value }))}
          className="subject-input"
        />
      </div>

      <div className="slider-group">
        <div className="slider-item">
          <label>Tone: {settings.tone > 0.7 ? "Fun" : settings.tone < 0.3 ? "Academic" : "Balanced"}</label>
          <input 
            type="range" 
            name="tone" 
            min="0" 
            max="1" 
            step="0.1" 
            value={settings.tone}
            onChange={handleChange}
          />
        </div>

        <div className="slider-item">
          <label>Visual Style: {settings.style > 0.7 ? "Realistic" : settings.style < 0.3 ? "Cartoonish" : "Digital Art"}</label>
          <input 
            type="range" 
            name="style" 
            min="0" 
            max="1" 
            step="0.1" 
            value={settings.style}
            onChange={handleChange}
          />
        </div>

        <div className="slider-item">
          <label>Complexity: {settings.complexity > 0.7 ? "Deep" : settings.complexity < 0.3 ? "Simple" : "Medium"}</label>
          <input 
            type="range" 
            name="complexity" 
            min="0" 
            max="1" 
            step="0.1" 
            value={settings.complexity}
            onChange={handleChange}
          />
        </div>
      </div>

      <div className="input-group">
        <label>Reading Level</label>
        <select name="level" value={settings.level} onChange={handleChange}>
          <option value="Toddler">Toddler</option>
          <option value="Student">Student</option>
          <option value="Expert">Expert</option>
        </select>
      </div>

      <button 
        onClick={onGenerate} 
        disabled={loading || !settings.subject}
        className="generate-btn"
      >
        {loading ? "Generating..." : "Generate Book"}
      </button>

      <style>{`
        .control-panel {
          background: #f8fafc;
          padding: 2rem;
          border-radius: 1rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          max-width: 400px;
          border: 1px solid #e2e8f0;
        }
        .input-group label, .slider-item label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 600;
          color: #475569;
        }
        .subject-input {
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          font-size: 1rem;
          box-sizing: border-box;
        }
        .slider-group {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .slider-item input {
          width: 100%;
        }
        select {
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          background: white;
        }
        .generate-btn {
          padding: 1rem;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 0.5rem;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s;
        }
        .generate-btn:hover:not(:disabled) {
          background: #2563eb;
        }
        .generate-btn:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

export default ControlPanel;
