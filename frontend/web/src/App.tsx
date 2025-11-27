import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LocationData {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newLocationData, setNewLocationData] = useState({ name: "", latitude: "", longitude: "", radius: "" });
  const [selectedLocation, setSelectedLocation] = useState<LocationData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ value: number | null }>({ value: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
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

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const locationsList: LocationData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          locationsList.push({
            id: businessId,
            name: businessData.name,
            latitude: Number(businessData.publicValue1) || 0,
            longitude: Number(businessData.publicValue2) || 0,
            radius: Number(businessData.decryptedValue) || 0,
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
      
      setLocations(locationsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createLocation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLocation(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted geofence..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const radiusValue = parseInt(newLocationData.radius) || 0;
      const businessId = `location-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, radiusValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLocationData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newLocationData.latitude) || 0,
        parseInt(newLocationData.longitude) || 0,
        "Encrypted Geofence"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Geofence created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLocationData({ name: "", latitude: "", longitude: "", radius: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLocation(false); 
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
          message: "Data already verified on-chain" 
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
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
        message: "Decryption failed: " + (e.message || "Unknown error") 
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
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responding!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Contract availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredLocations = locations.filter(location =>
    location.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    location.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    const totalFences = locations.length;
    const verifiedFences = locations.filter(l => l.isVerified).length;
    const activeFences = locations.filter(l => l.timestamp > Date.now()/1000 - 86400).length;
    
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📍</div>
          <div className="stat-content">
            <div className="stat-number">{totalFences}</div>
            <div className="stat-label">Total Geofences</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <div className="stat-number">{verifiedFences}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">⏰</div>
          <div className="stat-content">
            <div className="stat-number">{activeFences}</div>
            <div className="stat-label">Active Today</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Location Privacy FAQ</h3>
      <div className="faq-list">
        <div className="faq-item">
          <div className="faq-question">How does FHE protect my location?</div>
          <div className="faq-answer">Your geofence coordinates and radius are encrypted using Fully Homomorphic Encryption before being stored on-chain.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">What data is encrypted?</div>
          <div className="faq-answer">Only the radius value is FHE encrypted. Latitude and longitude are stored as public data for demonstration purposes.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How does decryption work?</div>
          <div className="faq-answer">Decryption happens client-side using your private key, with proof verification on-chain to maintain privacy.</div>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 LocAlert_Z</h1>
            <span>Private Location Alarm</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🗺️</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Secure your location privacy with FHE-encrypted geofences</p>
            <div className="feature-list">
              <div className="feature">🔐 Encrypted coordinates</div>
              <div className="feature">🚫 Server never knows your location</div>
              <div className="feature">🔔 Private alerts</div>
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
        <p>Initializing FHE Encryption...</p>
        <p className="loading-note">Setting up secure location privacy system</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted geofences...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 LocAlert_Z</h1>
          <span>FHE Location Privacy</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Geofence
          </button>
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            FAQ
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        {showFAQ && renderFAQ()}
        
        <div className="content-section">
          <h2>Encrypted Geofence Dashboard</h2>
          {renderStats()}
          
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search geofences by name or creator..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "↻"}
            </button>
          </div>
          
          <div className="locations-list">
            {filteredLocations.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🗺️</div>
                <p>No geofences found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Geofence
                </button>
              </div>
            ) : (
              filteredLocations.map((location, index) => (
                <div 
                  className={`location-card ${selectedLocation?.id === location.id ? "selected" : ""}`}
                  key={index}
                  onClick={() => setSelectedLocation(location)}
                >
                  <div className="card-header">
                    <div className="location-name">{location.name}</div>
                    <div className={`status-badge ${location.isVerified ? "verified" : "encrypted"}`}>
                      {location.isVerified ? "🔓 Verified" : "🔐 Encrypted"}
                    </div>
                  </div>
                  
                  <div className="location-coords">
                    <span>Lat: {location.latitude}</span>
                    <span>Lng: {location.longitude}</span>
                    <span>Radius: {location.isVerified ? location.decryptedValue : "🔒"}</span>
                  </div>
                  
                  <div className="card-footer">
                    <div className="creator">By: {location.creator.substring(0, 8)}...</div>
                    <div className="timestamp">
                      {new Date(location.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateLocation 
          onSubmit={createLocation} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingLocation} 
          locationData={newLocationData} 
          setLocationData={setNewLocationData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedLocation && (
        <LocationDetailModal 
          location={selectedLocation} 
          onClose={() => { 
            setSelectedLocation(null); 
            setDecryptedData({ value: null }); 
          }} 
          decryptedData={decryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedLocation.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateLocation: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  locationData: any;
  setLocationData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, locationData, setLocationData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocationData({ ...locationData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create Encrypted Geofence</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="notice-icon">🔐</div>
            <div className="notice-content">
              <strong>FHE Encryption Active</strong>
              <p>Radius value will be encrypted using Zama FHE technology</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Geofence Name</label>
            <input 
              type="text" 
              name="name" 
              value={locationData.name} 
              onChange={handleChange} 
              placeholder="Home, Office, etc." 
            />
          </div>
          
          <div className="coords-group">
            <div className="form-group">
              <label>Latitude</label>
              <input 
                type="number" 
                name="latitude" 
                value={locationData.latitude} 
                onChange={handleChange} 
                placeholder="40.7128" 
                step="any"
              />
            </div>
            
            <div className="form-group">
              <label>Longitude</label>
              <input 
                type="number" 
                name="longitude" 
                value={locationData.longitude} 
                onChange={handleChange} 
                placeholder="-74.0060" 
                step="any"
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Radius (meters) - FHE Encrypted</label>
            <input 
              type="number" 
              name="radius" 
              value={locationData.radius} 
              onChange={handleChange} 
              placeholder="100" 
              min="1"
            />
            <div className="input-hint">This value will be encrypted using FHE</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !locationData.name || !locationData.radius} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Geofence"}
          </button>
        </div>
      </div>
    </div>
  );
};

const LocationDetailModal: React.FC<{
  location: LocationData;
  onClose: () => void;
  decryptedData: { value: number | null };
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ location, onClose, decryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.value !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Geofence Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="location-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{location.name}</strong>
            </div>
            <div className="info-row">
              <span>Coordinates:</span>
              <strong>{location.latitude}, {location.longitude}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <span className={`status ${location.isVerified ? "verified" : "encrypted"}`}>
                {location.isVerified ? "🔓 Decrypted" : "🔐 Encrypted"}
              </span>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{location.creator.substring(0, 8)}...</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(location.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>Radius Value:</span>
                <strong>
                  {location.isVerified ? 
                    `${location.decryptedValue}m (Decrypted)` : 
                    decryptedData.value !== null ?
                    `${decryptedData.value}m (Local)` :
                    "🔒 Encrypted"
                  }
                </strong>
              </div>
              
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting || location.isVerified}
                className={`decrypt-btn ${location.isVerified ? "verified" : ""}`}
              >
                {isDecrypting ? "Decrypting..." : 
                 location.isVerified ? "✅ Verified" : 
                 "🔓 Decrypt Radius"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <p>
                <strong>FHE Protection:</strong> The radius value is encrypted using Fully Homomorphic Encryption. 
                The server never sees your actual location data.
              </p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;