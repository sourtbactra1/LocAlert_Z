pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LocAlert_Z is ZamaEthereumConfig {
    struct EncryptedGeoFence {
        euint32 encryptedLatitude;
        euint32 encryptedLongitude;
        euint32 encryptedRadius;
        uint256 publicTriggerCount;
        address creator;
        uint256 timestamp;
        bool isTriggered;
    }

    mapping(string => EncryptedGeoFence) public geoFences;
    string[] public fenceIds;

    event GeoFenceCreated(string indexed fenceId, address indexed creator);
    event LocationTriggered(string indexed fenceId, address indexed triggerer);

    constructor() ZamaEthereumConfig() {
    }

    function createGeoFence(
        string calldata fenceId,
        externalEuint32 encryptedLatitude,
        bytes calldata latitudeProof,
        externalEuint32 encryptedLongitude,
        bytes calldata longitudeProof,
        externalEuint32 encryptedRadius,
        bytes calldata radiusProof
    ) external {
        require(bytes(geoFences[fenceId].creator).length == 0, "GeoFence already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedLatitude, latitudeProof)), "Invalid encrypted latitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLongitude, longitudeProof)), "Invalid encrypted longitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedRadius, radiusProof)), "Invalid encrypted radius");
        
        geoFences[fenceId] = EncryptedGeoFence({
            encryptedLatitude: FHE.fromExternal(encryptedLatitude, latitudeProof),
            encryptedLongitude: FHE.fromExternal(encryptedLongitude, longitudeProof),
            encryptedRadius: FHE.fromExternal(encryptedRadius, radiusProof),
            publicTriggerCount: 0,
            creator: msg.sender,
            timestamp: block.timestamp,
            isTriggered: false
        });
        
        FHE.allowThis(geoFences[fenceId].encryptedLatitude);
        FHE.allowThis(geoFences[fenceId].encryptedLongitude);
        FHE.allowThis(geoFences[fenceId].encryptedRadius);
        
        FHE.makePubliclyDecryptable(geoFences[fenceId].encryptedLatitude);
        FHE.makePubliclyDecryptable(geoFences[fenceId].encryptedLongitude);
        FHE.makePubliclyDecryptable(geoFences[fenceId].encryptedRadius);
        
        fenceIds.push(fenceId);
        
        emit GeoFenceCreated(fenceId, msg.sender);
    }

    function checkLocation(
        string calldata fenceId,
        externalEuint32 encryptedUserLatitude,
        bytes calldata userLatitudeProof,
        externalEuint32 encryptedUserLongitude,
        bytes calldata userLongitudeProof
    ) external {
        require(bytes(geoFences[fenceId].creator).length > 0, "GeoFence does not exist");
        require(!geoFences[fenceId].isTriggered, "GeoFence already triggered");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedUserLatitude, userLatitudeProof)), "Invalid encrypted user latitude");
        require(FHE.isInitialized(FHE.fromExternal(encryptedUserLongitude, userLongitudeProof)), "Invalid encrypted user longitude");
        
        euint32 memory userLatitude = FHE.fromExternal(encryptedUserLatitude, userLatitudeProof);
        euint32 memory userLongitude = FHE.fromExternal(encryptedUserLongitude, userLongitudeProof);
        
        euint32 memory latitudeDiff = FHE.sub(userLatitude, geoFences[fenceId].encryptedLatitude);
        euint32 memory longitudeDiff = FHE.sub(userLongitude, geoFences[fenceId].encryptedLongitude);
        
        euint32 memory distanceSquared = FHE.add(
            FHE.mul(latitudeDiff, latitudeDiff),
            FHE.mul(longitudeDiff, longitudeDiff)
        );
        
        euint32 memory radiusSquared = FHE.mul(geoFences[fenceId].encryptedRadius, geoFences[fenceId].encryptedRadius);
        
        euint32 memory isWithin = FHE.le(distanceSquared, radiusSquared);
        
        if (FHE.decrypt(isWithin) != 0) {
            geoFences[fenceId].isTriggered = true;
            geoFences[fenceId].publicTriggerCount++;
            emit LocationTriggered(fenceId, msg.sender);
        }
    }

    function getEncryptedGeoFence(string calldata fenceId) external view returns (
        euint32 encryptedLatitude,
        euint32 encryptedLongitude,
        euint32 encryptedRadius
    ) {
        require(bytes(geoFences[fenceId].creator).length > 0, "GeoFence does not exist");
        return (
            geoFences[fenceId].encryptedLatitude,
            geoFences[fenceId].encryptedLongitude,
            geoFences[fenceId].encryptedRadius
        );
    }

    function getGeoFenceInfo(string calldata fenceId) external view returns (
        uint256 publicTriggerCount,
        address creator,
        uint256 timestamp,
        bool isTriggered
    ) {
        require(bytes(geoFences[fenceId].creator).length > 0, "GeoFence does not exist");
        return (
            geoFences[fenceId].publicTriggerCount,
            geoFences[fenceId].creator,
            geoFences[fenceId].timestamp,
            geoFences[fenceId].isTriggered
        );
    }

    function getAllFenceIds() external view returns (string[] memory) {
        return fenceIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

