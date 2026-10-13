// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title MockChog — testnet stand-in for the Chog Genesis NFT collection.
/// @notice Each token stores the 11 Chog trait categories fully onchain.
/// tokenURI returns a base64 data-URI JSON document so no IPFS gateway is needed.
contract MockChog is ERC721Enumerable, Ownable {
    uint256 private _nextTokenId;

    string[11] private _categories = [
        "Background",
        "Base",
        "Body",
        "Eyes",
        "Form",
        "Head",
        "Mouth",
        "Naked",
        "Side",
        "Skin",
        "Tier"
    ];

    // tokenId => trait values in _categories order
    mapping(uint256 => string[11]) private _traits;

    constructor() ERC721("Mock Chog", "MCHOG") Ownable(msg.sender) {}

    function traitCategories() external view returns (string[11] memory) {
        return _categories;
    }

    function traitsOf(uint256 tokenId) external view returns (string[11] memory) {
        _requireOwned(tokenId);
        return _traits[tokenId];
    }

    /// @dev Mints token `tokenId` to `to` with explicit trait values (owner only).
    function mintWithTraits(address to, string[11] calldata traitValues)
        external
        onlyOwner
        returns (uint256)
    {
        uint256 tokenId = _nextTokenId++;
        for (uint256 i = 0; i < 11; i++) {
            _traits[tokenId][i] = traitValues[i];
        }
        _safeMint(to, tokenId);
        return tokenId;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string[11] memory values = _traits[tokenId];

        bytes memory attributes = abi.encodePacked("[");
        for (uint256 i = 0; i < 11; i++) {
            attributes = abi.encodePacked(
                attributes,
                '{"trait_type":"',
                _categories[i],
                '","value":"',
                values[i],
                '"}',
                i < 10 ? "," : ""
            );
        }
        attributes = abi.encodePacked(attributes, "]");

        bytes memory json = abi.encodePacked(
            '{"name":"Mock Chog #',
            _toString(tokenId),
            '","description":"A testnet Chog with a Soul.",',
            '"image":"https://example.com/mock-chog/',
            _toString(tokenId),
            '.png",',
            '"attributes":',
            attributes,
            "}"
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
