import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface LocationFence {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface LocationStats {
  totalFences: number;
  activeFences: number;
  avgRadius: number;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [fences, setFences] = useState<LocationFence[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingFence, setCreatingFence] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newFenceData, setNewFenceData] = useState({ name: "", latitude: "", longitude: "", radius: "" });
  const [selectedFence, setSelectedFence] = useState<LocationFence | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<LocationStats>({ totalFences: 0, activeFences: 0, avgRadius: 0, recentActivity: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) {
        return;
      }
      
      if (isInitialized) {
        return;
      }
      
      if (fhevmInitializing) {
        return;
      }
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
        addToHistory("FHEVM initialized successfully");
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (message: string) => {
    setOperationHistory(prev => [`${new Date().toLocaleTimeString()}: ${message}`, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const fencesList: LocationFence[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          fencesList.push({
            id: parseInt(businessId.replace('fence-', '')) || Date.now(),
            name: businessData.name,
            latitude: businessId,
            longitude: businessId,
            radius: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setFences(fencesList);
      updateStats(fencesList);
      addToHistory(`Loaded ${fencesList.length} encrypted fences`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (fencesList: LocationFence[]) => {
    const totalFences = fencesList.length;
    const activeFences = fencesList.filter(f => f.isVerified).length;
    const avgRadius = fencesList.length > 0 
      ? fencesList.reduce((sum, f) => sum + f.publicValue1, 0) / fencesList.length 
      : 0;
    const recentActivity = fencesList.filter(f => 
      Date.now()/1000 - f.timestamp < 60 * 60 * 24 * 7
    ).length;

    setStats({ totalFences, activeFences, avgRadius, recentActivity });
  };

  const createFence = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingFence(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted geofence with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const latitudeValue = parseInt(newFenceData.latitude) || 0;
      const businessId = `fence-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, latitudeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newFenceData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newFenceData.radius) || 0,
        0,
        "Encrypted Location Fence"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Geofence created successfully!" });
      addToHistory("Created new encrypted geofence");
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewFenceData({ name: "", latitude: "", longitude: "", radius: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingFence(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Location data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying location decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory("Decrypted and verified location data");
      
      setTransactionStatus({ visible: true, status: "success", message: "Location data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Location data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Location decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE System is available and ready!" });
        addToHistory("Tested FHE system availability - Success");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "FHE System test failed" });
    }
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="panel gradient-panel">
          <h3>Total Fences</h3>
          <div className="stat-value">{stats.totalFences}</div>
          <div className="stat-trend">+{stats.recentActivity} this week</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Active Fences</h3>
          <div className="stat-value">{stats.activeFences}/{stats.totalFences}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Avg Radius</h3>
          <div className="stat-value">{stats.avgRadius.toFixed(1)}m</div>
          <div className="stat-trend">Encrypted Range</div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔐</div>
          <div className="step-content">
            <h4>Location Encryption</h4>
            <p>GPS coordinates encrypted with Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🌐</div>
          <div className="step-content">
            <h4>Private Storage</h4>
            <p>Encrypted data stored on-chain, server blind to location</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔍</div>
          <div className="step-content">
            <h4>Homomorphic Check</h4>
            <p>Server computes proximity without decrypting</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔔</div>
          <div className="step-content">
            <h4>Private Alert</h4>
            <p>Trigger notification while keeping location private</p>
          </div>
        </div>
      </div>
    );
  };

  const renderOperationHistory = () => {
    return (
      <div className="history-panel">
        <h3>Operation History</h3>
        <div className="history-list">
          {operationHistory.length === 0 ? (
            <p className="no-history">No operations yet</p>
          ) : (
            operationHistory.map((op, index) => (
              <div key={index} className="history-item">
                {op}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>LocAlert_Z 🔐</h1>
            <span>Private Location Alarm</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🗺️🔐</div>
            <h2>Connect Your Wallet for Private Location Alerts</h2>
            <p>Set encrypted geofences that trigger alerts when you enter the area, while keeping your location private from the server.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted location fences with Zama FHE</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Receive private alerts without revealing your location</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Location Privacy System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">Setting up encrypted geofencing</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted location system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>LocAlert_Z 🗺️🔐</h1>
          <span>Private Location Alarm with FHE</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE System
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Geofence
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Private Location Monitoring (FHE 🔐)</h2>
          {renderStatsPanel()}
          
          <div className="panel gradient-panel full-width">
            <h3>FHE 🔐 Location Privacy Flow</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="content-grid">
          <div className="fences-section">
            <div className="section-header">
              <h2>Encrypted Geofences</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="fences-list">
              {fences.length === 0 ? (
                <div className="no-fences">
                  <p>No encrypted geofences found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Fence
                  </button>
                </div>
              ) : fences.map((fence, index) => (
                <div 
                  className={`fence-item ${selectedFence?.id === fence.id ? "selected" : ""} ${fence.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedFence(fence)}
                >
                  <div className="fence-title">{fence.name}</div>
                  <div className="fence-meta">
                    <span>Radius: {fence.publicValue1}m</span>
                    <span>Created: {new Date(fence.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="fence-status">
                    Status: {fence.isVerified ? "✅ Location Verified" : "🔓 Ready for Verification"}
                    {fence.isVerified && fence.decryptedValue && (
                      <span className="verified-coords">Lat: {fence.decryptedValue}</span>
                    )}
                  </div>
                  <div className="fence-creator">Creator: {fence.creator.substring(0, 6)}...{fence.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="sidebar">
            {renderOperationHistory()}
            
            <div className="info-panel">
              <h3>Privacy Features</h3>
              <ul>
                <li>🔐 Server-blind location tracking</li>
                <li>🗺️ Encrypted geofence coordinates</li>
                <li>🔔 Homomorphic trigger logic</li>
                <li>🌐 Zero-knowledge proximity checks</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateFence 
          onSubmit={createFence} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingFence} 
          fenceData={newFenceData} 
          setFenceData={setNewFenceData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedFence && (
        <FenceDetailModal 
          fence={selectedFence} 
          onClose={() => { 
            setSelectedFence(null); 
            setDecryptedData({ latitude: null, longitude: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedFence.latitude)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateFence: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  fenceData: any;
  setFenceData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, fenceData, setFenceData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'latitude') {
      const intValue = value.replace(/[^\d-]/g, '');
      setFenceData({ ...fenceData, [name]: intValue });
    } else {
      setFenceData({ ...fenceData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-fence-modal">
        <div className="modal-header">
          <h2>New Encrypted Geofence</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Location Privacy</strong>
            <p>GPS coordinates encrypted with Zama FHE (Integer coordinates only)</p>
          </div>
          
          <div className="form-group">
            <label>Fence Name *</label>
            <input 
              type="text" 
              name="name" 
              value={fenceData.name} 
              onChange={handleChange} 
              placeholder="Enter fence name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Latitude (Integer only) *</label>
            <input 
              type="number" 
              name="latitude" 
              value={fenceData.latitude} 
              onChange={handleChange} 
              placeholder="Enter latitude..." 
              step="1"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Longitude (Public) *</label>
            <input 
              type="number" 
              name="longitude" 
              value={fenceData.longitude} 
              onChange={handleChange} 
              placeholder="Enter longitude..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Radius (meters) *</label>
            <input 
              type="number" 
              min="10" 
              max="10000" 
              name="radius" 
              value={fenceData.radius} 
              onChange={handleChange} 
              placeholder="Enter radius..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !fenceData.name || !fenceData.latitude || !fenceData.radius} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Geofence"}
          </button>
        </div>
      </div>
    </div>
  );
};

const FenceDetailModal: React.FC<{
  fence: LocationFence;
  onClose: () => void;
  decryptedData: { latitude: number | null; longitude: number | null };
  setDecryptedData: (value: { latitude: number | null; longitude: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ fence, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.latitude !== null) { 
      setDecryptedData({ latitude: null, longitude: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ latitude: decrypted, longitude: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="fence-detail-modal">
        <div className="modal-header">
          <h2>Geofence Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fence-info">
            <div className="info-item">
              <span>Fence Name:</span>
              <strong>{fence.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{fence.creator.substring(0, 6)}...{fence.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(fence.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Alert Radius:</span>
              <strong>{fence.publicValue1}m</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Location Data</h3>
            
            <div className="data-row">
              <div className="data-label">Latitude Coordinate:</div>
              <div className="data-value">
                {fence.isVerified && fence.decryptedValue ? 
                  `${fence.decryptedValue} (On-chain Verified)` : 
                  decryptedData.latitude !== null ? 
                  `${decryptedData.latitude} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(fence.isVerified || decryptedData.latitude !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : fence.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.latitude !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Location"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Location Privacy</strong>
                <p>GPS coordinates are encrypted on-chain. Verify to decrypt and confirm location privacy.</p>
              </div>
            </div>
          </div>
          
          {(fence.isVerified || decryptedData.latitude !== null) && (
            <div className="privacy-section">
              <h3>Location Privacy Status</h3>
              <div className="privacy-status">
                <div className="status-item verified">
                  <span>Coordinate Encryption:</span>
                  <strong>FHE Protected</strong>
                </div>
                <div className="status-item">
                  <span>Server Knowledge:</span>
                  <strong>Zero Location Data</strong>
                </div>
                <div className="status-item">
                  <span>Alert Trigger:</span>
                  <strong>Homomorphic Check</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!fence.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify Location Privacy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

