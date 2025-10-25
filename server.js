const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Manual admin password - change this to your desired password
const ADMIN_PASSWORD = 'admin123';

// Initialize SQLite Database
const db = new sqlite3.Database('./keys.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    keyType TEXT NOT NULL,
    expiration_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    isActive BOOLEAN DEFAULT 1,
    used BOOLEAN DEFAULT 0,
    used_by TEXT,
    used_at DATETIME
  )`, (err) => {
    if (err) {
      console.error('Error creating keys table:', err.message);
    } else {
      console.log('Keys table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS key_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_generated INTEGER DEFAULT 0,
    active_keys INTEGER DEFAULT 0,
    revoked_keys INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating stats table:', err.message);
    } else {
      console.log('Stats table ready.');
      // Initialize stats if empty
      initializeStats();
    }
  });
}

function initializeStats() {
  db.get("SELECT * FROM key_stats WHERE id = 1", (err, row) => {
    if (!row) {
      db.run("INSERT INTO key_stats (id, total_generated, active_keys, revoked_keys) VALUES (1, 0, 0, 0)");
    }
  });
}

// Key generation function
function generateKey(type, days = null) {
  const prefix = "VERDANT-KEY";
  let keyType, expirationDays;
  
  switch(type) {
    case 'hour':
      keyType = '1HOUR';
      expirationDays = 1/24;
      break;
    case 'day':
      keyType = '1DAY';
      expirationDays = 1;
      break;
    case 'week':
      keyType = '7DAYS';
      expirationDays = 7;
      break;
    case 'month':
      keyType = '30DAYS';
      expirationDays = 30;
      break;
    case 'permanent':
      keyType = 'LIFETIME';
      expirationDays = 36500;
      break;
    case 'custom':
      keyType = `${days}DAYS`;
      expirationDays = days;
      break;
    default:
      keyType = '1DAY';
      expirationDays = 1;
  }
  
  const uniqueId = uuidv4().substr(0, 8).toUpperCase();
  const key = `${prefix}-${keyType}-${uniqueId}`;
  
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + expirationDays);
  
  return {
    key: key,
    type: type,
    keyType: keyType,
    expiration_date: expirationDate.toISOString().split('T')[0],
    created_at: new Date().toISOString(),
    isActive: true,
    used: false,
    used_by: null,
    used_at: null,
    days: expirationDays
  };
}

// Validation endpoint
app.post('/api/validate', (req, res) => {
  const { key, device_id, app_version = "1.0.0" } = req.body;
  
  console.log(`Validation attempt: ${key}, Device: ${device_id}`);
  
  if (!key || !device_id) {
    return res.json({
      success: false,
      valid: false,
      message: "Missing key or device ID"
    });
  }
  
  // Check key in database
  db.get("SELECT * FROM keys WHERE key = ?", [key], (err, row) => {
    if (err) {
      return res.json({
        success: false,
        valid: false,
        message: "Database error"
      });
    }
    
    if (!row) {
      return res.json({
        success: true,
        valid: false,
        message: "Invalid license key"
      });
    }
    
    if (!row.isActive) {
      return res.json({
        success: true,
        valid: false,
        message: "Key has been revoked"
      });
    }
    
    // Check expiration
    const currentDate = new Date().toISOString().split('T')[0];
    if (currentDate > row.expiration_date) {
      return res.json({
        success: true,
        valid: false,
        message: "License has expired"
      });
    }
    
    // Check if key already used on different device
    if (row.used && row.used_by !== device_id) {
      return res.json({
        success: true,
        valid: false,
        message: "Key already activated on another device"
      });
    }
    
    // Activate key if not used
    if (!row.used) {
      db.run(
        "UPDATE keys SET used = 1, used_by = ?, used_at = datetime('now') WHERE key = ?",
        [device_id, key],
        (err) => {
          if (err) {
            console.error('Error updating key usage:', err);
          }
        }
      );
    }
    
    res.json({
      success: true,
      valid: true,
      message: "Access granted!",
      expiration_date: row.expiration_date,
      user_level: "premium",
      key_type: row.keyType
    });
  });
});

// Admin endpoints
app.post('/api/admin/generate', (req, res) => {
  const { type, quantity = 1, days = null, admin_password } = req.body;
  
  if (admin_password !== ADMIN_PASSWORD) {
    return res.json({
      success: false,
      message: "Invalid admin password"
    });
  }
  
  const validTypes = ['hour', 'day', 'week', 'month', 'permanent', 'custom'];
  if (!validTypes.includes(type)) {
    return res.json({
      success: false,
      message: "Invalid key type"
    });
  }
  
  if (type === 'custom' && (!days || days < 1)) {
    return res.json({
      success: false,
      message: "Custom keys require days parameter"
    });
  }
  
  const generatedKeys = [];
  let keysGenerated = 0;
  
  function generateNextKey() {
    if (keysGenerated < quantity) {
      const newKey = generateKey(type, days);
      
      db.run(
        `INSERT INTO keys (key, type, keyType, expiration_date, created_at, isActive, used, days) 
         VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
        [newKey.key, newKey.type, newKey.keyType, newKey.expiration_date, newKey.created_at, newKey.days],
        function(err) {
          if (err) {
            console.error('Error saving key:', err);
            return res.json({
              success: false,
              message: "Error generating keys"
            });
          }
          
          generatedKeys.push(newKey);
          keysGenerated++;
          
          if (keysGenerated < quantity) {
            generateNextKey();
          } else {
            // Update stats
            db.run(
              "UPDATE key_stats SET total_generated = total_generated + ?, active_keys = active_keys + ?, updated_at = datetime('now') WHERE id = 1",
              [quantity, quantity],
              (err) => {
                if (err) console.error('Error updating stats:', err);
                
                res.json({
                  success: true,
                  message: `Generated ${quantity} ${type} key(s)`,
                  keys: generatedKeys
                });
              }
            );
          }
        }
      );
    }
  }
  
  generateNextKey();
});

app.post('/api/admin/revoke', (req, res) => {
  const { key, admin_password } = req.body;
  
  if (admin_password !== ADMIN_PASSWORD) {
    return res.json({
      success: false,
      message: "Invalid admin password"
    });
  }
  
  db.get("SELECT * FROM keys WHERE key = ?", [key], (err, row) => {
    if (err) {
      return res.json({
        success: false,
        message: "Database error"
      });
    }
    
    if (!row) {
      return res.json({
        success: false,
        message: "Key not found"
      });
    }
    
    if (!row.isActive) {
      return res.json({
        success: false,
        message: "Key already revoked"
      });
    }
    
    db.run(
      "UPDATE keys SET isActive = 0 WHERE key = ?",
      [key],
      function(err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error revoking key"
          });
        }
        
        // Update stats
        db.run(
          "UPDATE key_stats SET revoked_keys = revoked_keys + 1, active_keys = active_keys - 1, updated_at = datetime('now') WHERE id = 1",
          (err) => {
            if (err) console.error('Error updating stats:', err);
            
            res.json({
              success: true,
              message: "Key revoked successfully"
            });
          }
        );
      }
    );
  });
});

app.get('/api/admin/keys', (req, res) => {
  const { admin_password } = req.query;
  
  if (admin_password !== ADMIN_PASSWORD) {
    return res.json({
      success: false,
      message: "Invalid admin password"
    });
  }
  
  db.all("SELECT * FROM keys ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      return res.json({
        success: false,
        message: "Database error"
      });
    }
    
    db.get("SELECT * FROM key_stats WHERE id = 1", (err, stats) => {
      if (err) {
        console.error('Error getting stats:', err);
        stats = { total_generated: 0, active_keys: 0, revoked_keys: 0 };
      }
      
      const keyList = rows.map(key => ({
        key: key.key,
        type: key.type,
        keyType: key.keyType,
        expiration_date: key.expiration_date,
        created_at: key.created_at,
        isActive: Boolean(key.isActive),
        used: Boolean(key.used),
        used_by: key.used_by ? key.used_by.substring(0, 8) + '...' : null,
        used_at: key.used_at
      }));
      
      res.json({
        success: true,
        keys: keyList,
        stats: {
          total_generated: stats.total_generated,
          active_keys: stats.active_keys,
          revoked_keys: stats.revoked_keys
        }
      });
    });
  });
});

app.delete('/api/admin/keys/:key', (req, res) => {
  const { key } = req.params;
  const { admin_password } = req.body;
  
  if (admin_password !== ADMIN_PASSWORD) {
    return res.json({
      success: false,
      message: "Invalid admin password"
    });
  }
  
  db.get("SELECT * FROM keys WHERE key = ?", [key], (err, row) => {
    if (err) {
      return res.json({
        success: false,
        message: "Database error"
      });
    }
    
    if (!row) {
      return res.json({
        success: false,
        message: "Key not found"
      });
    }
    
    const wasActive = Boolean(row.isActive);
    
    db.run("DELETE FROM keys WHERE key = ?", [key], function(err) {
      if (err) {
        return res.json({
          success: false,
          message: "Error deleting key"
        });
      }
      
      // Update stats
      let updateQuery = "UPDATE key_stats SET total_generated = total_generated - 1";
      if (wasActive) {
        updateQuery += ", active_keys = active_keys - 1";
      } else {
        updateQuery += ", revoked_keys = revoked_keys - 1";
      }
      updateQuery += ", updated_at = datetime('now') WHERE id = 1";
      
      db.run(updateQuery, (err) => {
        if (err) console.error('Error updating stats:', err);
        
        res.json({
          success: true,
          message: "Key deleted permanently"
        });
      });
    });
  });
});

// Health check
app.get('/health', (req, res) => {
  db.get("SELECT COUNT(*) as key_count FROM keys", (err, row) => {
    if (err) {
      return res.json({ 
        status: 'ERROR', 
        timestamp: new Date().toISOString(),
        error: 'Database error'
      });
    }
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      total_keys: row.key_count,
      database: 'SQLite'
    });
  });
});

// Serve admin panel
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// Close database connection on exit
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Key management server running on port ${PORT}`);
  console.log(`🗄️  Using SQLite database: keys.db`);
  console.log(`🔑 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔐 Admin password: ${ADMIN_PASSWORD}`);
});