import React, { FunctionComponent } from 'react';

export interface BrandProps {
    brand?: string;
}

const BrandLogo: FunctionComponent<BrandProps> = ({
    brand,
}) => (
    <div className="brandLogo">
        <div className={brand}></div>
    </div>
);

export default BrandLogo;
