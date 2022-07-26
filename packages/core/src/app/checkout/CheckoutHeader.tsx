import React, { FunctionComponent } from 'react';

export interface HeaderProps {
    siteUrl: string,
    logoUrl: string;
}

const CheckoutHeader: FunctionComponent<HeaderProps> = ({
    children,
    siteUrl,
    logoUrl
}) => (

    <div className="hiddenContainer">
        <div className="checkoutHeader-left">
            <div className="checkoutHeaderNew__logo">
                <a href={ siteUrl }><img src={ logoUrl } /></a>
                { children }
            </div>
        </div>
    </div>
);

export default CheckoutHeader;