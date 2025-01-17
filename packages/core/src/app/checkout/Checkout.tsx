import { Address, Cart, CartChangedError, CheckoutParams, CheckoutSelectors, Consignment, EmbeddedCheckoutMessenger, EmbeddedCheckoutMessengerOptions, FlashMessage, Promotion, RequestOptions, StepTracker } from '@bigcommerce/checkout-sdk';
import classNames from 'classnames';
import { find, findIndex } from 'lodash';
import React, { lazy, Component, ReactNode } from 'react';

import { StaticBillingAddress } from '../billing';
import { EmptyCartMessage } from '../cart';
import { isCustomError, CustomError, ErrorLogger, ErrorModal } from '../common/error';
import { retry } from '../common/utility';
import { CheckoutSuggestion, CustomerInfo, CustomerSignOutEvent, CustomerViewType } from '../customer';
import { isEmbedded, EmbeddedCheckoutStylesheet } from '../embeddedCheckout';
import { withLanguage, TranslatedString, WithLanguageProps } from '../locale';
import { PromotionBannerList } from '../promotion';
import { hasSelectedShippingOptions, isUsingMultiShipping, StaticConsignment } from '../shipping';
import { ShippingOptionExpiredError } from '../shipping/shippingOption';
import { LazyContainer, LoadingNotification, LoadingOverlay } from '../ui/loading';
import { MobileView } from '../ui/responsive';

import mapToCheckoutProps from './mapToCheckoutProps';
import navigateToOrderConfirmation from './navigateToOrderConfirmation';
import withCheckout from './withCheckout';
import CheckoutStep from './CheckoutStep';
import CheckoutStepStatus from './CheckoutStepStatus';
import CheckoutStepType from './CheckoutStepType';
import CheckoutSupport from './CheckoutSupport';

import CheckoutHeader from './CheckoutHeader';

const Billing = lazy(() => retry(() => import(
    /* webpackChunkName: "billing" */
    '../billing/Billing'
)));

const CartSummary = lazy(() => retry(() => import(
    /* webpackChunkName: "cart-summary" */
    '../cart/CartSummary'
)));

const CartSummaryDrawer = lazy(() => retry(() => import(
    /* webpackChunkName: "cart-summary-drawer" */
    '../cart/CartSummaryDrawer'
)));

const Customer = lazy(() => retry(() => import(
    /* webpackChunkName: "customer" */
    '../customer/Customer'
)));

const Payment = lazy(() => retry(() => import(
    /* webpackChunkName: "payment" */
    '../payment/Payment'
)));

const Shipping = lazy(() => retry(() => import(
    /* webpackChunkName: "shipping" */
    '../shipping/Shipping'
)));

let checkout_branded: boolean = false;
let site_info:string[] = ['',''];

export interface CheckoutProps {
    checkoutId: string;
    containerId: string;
    embeddedStylesheet: EmbeddedCheckoutStylesheet;
    embeddedSupport: CheckoutSupport;
    errorLogger: ErrorLogger;
    createEmbeddedMessenger(options: EmbeddedCheckoutMessengerOptions): EmbeddedCheckoutMessenger;
    createStepTracker(): StepTracker;
}

export interface CheckoutState {
    activeStepType?: CheckoutStepType;
    isBillingSameAsShipping: boolean;
    customerViewType?: CustomerViewType;
    defaultStepType?: CheckoutStepType;
    error?: Error;
    flashMessages?: FlashMessage[];
    isMultiShippingMode: boolean;
    isCartEmpty: boolean;
    isRedirecting: boolean;
    hasSelectedShippingOptions: boolean;
    isBuyNowCartEnabled: boolean;
}

export interface WithCheckoutProps {
    billingAddress?: Address;
    cart?: Cart;
    consignments?: Consignment[];
    error?: Error;
    hasCartChanged: boolean;
    flashMessages?: FlashMessage[];
    isGuestEnabled: boolean;
    isLoadingCheckout: boolean;
    isPending: boolean;
    loginUrl: string;
    createAccountUrl: string;
    canCreateAccountInCheckout: boolean;
    promotions?: Promotion[];
    steps: CheckoutStepStatus[];
    clearError(error?: Error): void;
    loadCheckout(id: string, options?: RequestOptions<CheckoutParams>): Promise<CheckoutSelectors>;
    subscribeToConsignments(subscriber: (state: CheckoutSelectors) => void): () => void;
}

class Checkout extends Component<CheckoutProps & WithCheckoutProps & WithLanguageProps, CheckoutState> {
    stepTracker: StepTracker | undefined;

    state: CheckoutState = {
        isBillingSameAsShipping: true,
        isCartEmpty: false,
        isRedirecting: false,
        isMultiShippingMode: false,
        hasSelectedShippingOptions: false,
        isBuyNowCartEnabled: false,
    };

    private embeddedMessenger?: EmbeddedCheckoutMessenger;
    private unsubscribeFromConsignments?: () => void;

    componentWillUnmount(): void {
        if (this.unsubscribeFromConsignments) {
            this.unsubscribeFromConsignments();
            this.unsubscribeFromConsignments = undefined;
        }
    }

    async componentDidMount(): Promise<void> {
        const {
            checkoutId,
            containerId,
            createStepTracker,
            createEmbeddedMessenger,
            embeddedStylesheet,
            loadCheckout,
            subscribeToConsignments,
        } = this.props;

        try {
            const { data } = await loadCheckout(checkoutId, {
                params: {
                    include: [
                        'cart.lineItems.physicalItems.categoryNames',
                        'cart.lineItems.digitalItems.categoryNames',
                    ] as any, // FIXME: Currently the enum is not exported so it can't be used here.
                },
            });


            if( this.props !== undefined && this.props.cart !== undefined && this.props.cart.id !== undefined ){
                let cart_id = this.props.cart.id;
                let cache_breaker = Math.floor( Math.random() * 1000 ).toString();

                fetch('https://bpagutility.wpengine.com/wp-content/plugins/cart-repo/get-info.php?cart_id='+cart_id+'&rand='+cache_breaker)
                .then(response => response.text())
                .then(brand => {
                    console.log(brand);
                    site_info = this.get_site_url_and_logo(this.props.cart, brand);
                    this.setState({
                            
                    })
                })
                .catch(err => {
                    console.log(err);
                    if( this.props !== undefined && this.props.cart !== undefined && this.props.cart.lineItems !== undefined && this.props.cart.lineItems.physicalItems !== undefined ){
                        let line_items = this.props.cart.lineItems.physicalItems;
                        console.log('error');
                        console.log(line_items);
                        let brand = '';
                        if( line_items.length > 0 ){
                            let last_item = line_items[line_items.length - 1];
                            brand = last_item.brand;
                        } else {
                            if( this.props.cart.lineItems.digitalItems !== undefined ){
                                let digital_line_items = this.props.cart.lineItems.digitalItems;
                                let last_digital_item = digital_line_items[digital_line_items.length - 1];
                                brand = last_digital_item.brand;
                            }
                        }
                        site_info = this.get_site_url_and_logo(cart, brand);
                        this.setState({
                            
                          })
                    }
                });
            }


            const { links: { siteLink = '' } = {} } = data.getConfig() || {};
            const errorFlashMessages = data.getFlashMessages('error') || [];

            if (errorFlashMessages.length) {
                const { language } = this.props;

                this.setState({
                    error: new CustomError({
                        title: errorFlashMessages[0].title || language.translate('common.error_heading'),
                        message: errorFlashMessages[0].message,
                        data: {},
                        name: 'default',
                    }),
                });
            }

            const messenger = createEmbeddedMessenger({ parentOrigin: siteLink });

            this.unsubscribeFromConsignments = subscribeToConsignments(this.handleConsignmentsUpdated);
            this.embeddedMessenger = messenger;
            messenger.receiveStyles(styles => embeddedStylesheet.append(styles));
            messenger.postFrameLoaded({ contentId: containerId });
            messenger.postLoaded();

            this.stepTracker = createStepTracker();
            this.stepTracker.trackCheckoutStarted();

            const consignments = data.getConsignments();
            const cart = data.getCart();

            const hasMultiShippingEnabled = data.getConfig()?.checkoutSettings?.hasMultiShippingEnabled;
            const checkoutBillingSameAsShippingEnabled = data.getConfig()?.checkoutSettings?.checkoutBillingSameAsShippingEnabled ?? true;
            const buyNowCartFlag = data.getConfig()?.checkoutSettings?.features['CHECKOUT-3190.enable_buy_now_cart'] ?? false;
            const isMultiShippingMode = !!cart &&
                !!consignments &&
                hasMultiShippingEnabled &&
                isUsingMultiShipping(consignments, cart.lineItems);

            this.setState({ isBillingSameAsShipping: checkoutBillingSameAsShippingEnabled, isBuyNowCartEnabled: buyNowCartFlag });

            if (isMultiShippingMode) {
                this.setState({ isMultiShippingMode }, this.handleReady);
            } else {
                this.handleReady();
            }
        } catch (error) {
            this.handleUnhandledError(error);
        }
    }

    render(): ReactNode {
        const { error } = this.state;
        let errorModal = null;

        if (error) {
            if (isCustomError(error)) {
                errorModal = <ErrorModal error={ error } onClose={ this.handleCloseErrorModal } title={ error.title } />;
            } else {
                errorModal = <ErrorModal error={ error } onClose={ this.handleCloseErrorModal } />;
            }
        }

        return <>
            <div className={ classNames({ 'is-embedded': isEmbedded() }) }>
                <div className="layout optimizedCheckout-contentPrimary">
                    { this.renderContent() }
                </div>
                { errorModal }
            </div>

        </>;
    }

    private renderContent(): ReactNode {
        const {
            isPending,
            loginUrl,
            promotions = [],
            steps,
        } = this.props;

        const {
            activeStepType,
            defaultStepType,
            isCartEmpty,
            isRedirecting,
        } = this.state;

        if (isCartEmpty) {
            return (
                <EmptyCartMessage
                    loginUrl={ loginUrl }
                    waitInterval={ 3000 }
                />
            );
        }

        return (
            <LoadingOverlay
                hideContentWhenLoading
                isLoading={ isRedirecting }
            >

                { this.renderCheckoutHeader( this.props.cart ) }
                { this.displayCheckoutHeader() }
                { this.displayCheckout() }
                
                <div className="layout-main">
                    <LoadingNotification isLoading={ isPending } />

                    <PromotionBannerList promotions={ promotions } />

                    <ol className="checkout-steps">
                        { steps
                            .filter(step => step.isRequired)
                            .map(step => this.renderStep({
                                ...step,
                                isActive: activeStepType ? activeStepType === step.type : defaultStepType === step.type,
                            })) }
                    </ol>
                </div>

                { this.renderCartSummary() }
                { this.displayCheckoutHeader() }
                

            </LoadingOverlay>
        );
    }

    private displayCheckoutHeader(){       
            const hiddenContainer = document.querySelector('.hiddenContainer');
            const checkoutHeader = document.querySelector('.checkoutHeader');
            const checkoutHeader_content = document.querySelector('.checkoutHeader-content');
            const header_ready_interval = setInterval(() => {
                if(  hiddenContainer && checkoutHeader && checkoutHeader_content ){
                    clearInterval( header_ready_interval );
                    console.log( 'display header' );
                    const content = hiddenContainer.innerHTML;
                    if( content && content !== '' ){
                        checkoutHeader_content.innerHTML = content;
                        hiddenContainer.innerHTML = '';
                        checkoutHeader.classList.add('active');
                    }
                }
            }, 500);    
    }

    private displayCheckout(){       
        const checkout_app = document.getElementById('checkout-app');
        if( checkout_app ){
            checkout_app.style.opacity = '0';
            checkout_app.style.display = 'block';
            (function fade() {
                var val = parseFloat(checkout_app.style.opacity);
                if (!((val += .1) > 1)) {
                    checkout_app.style.opacity = val.toString();
                    requestAnimationFrame(fade);
                }
            })();
        }
    }

    private updateCartHeaderLink( link: string ){
        if( ! checkout_branded ){
            const cart_anchor = document.querySelector('.cart-header .cart-header-link');
            const modal_cart_anchor = document.querySelector('.cart-modal-header .cart-modal-link');
            if( cart_anchor ){
                cart_anchor.setAttribute('href', link);
            }
            if( modal_cart_anchor ){
                modal_cart_anchor.setAttribute('href', link);
            }
        }
    }

    private renderCheckoutHeader(cart?: Cart): ReactNode {
        if( cart !== undefined && site_info[0] != '' && ! checkout_branded ){
            checkout_branded = true;
            console.log(site_info[0]+' || '+site_info[1]);
            return (
                <CheckoutHeader siteUrl={site_info[0]} logoUrl={site_info[1]} />
            )

            /*let cart_id = cart.id;

            let times_up: boolean = false;
            let brand = '';

            let checkout = this;

            fetch('https://bpagutility.wpengine.com/wp-content/plugins/cart-repo/get-info.php?cart_id='+cart_id)
                .then(response => response.text())
                .then(brand => {
                    console.log('brand: '+brand);
                    if( ! times_up ){
                        checkout_branded = true;
                        site_info = checkout.get_site_url_and_logo(cart, brand);
                        if( site_info && site_info !== undefined ){
                            console.log('site info: ');
                            console.log(site_info);
                            return (
                                <CheckoutHeader siteUrl={site_info[0]} logoUrl={site_info[1]} />
                            )
                        }
                    }
                });

            setTimeout( function(){
                console.log('times up!');
                times_up = true;

                if( ! checkout_branded ){
                    let line_items = cart.lineItems.physicalItems;
                    if( line_items.length > 0 ){
                        let last_item = line_items[line_items.length - 1];
                        brand = last_item.brand;
                    } else {
                        let digital_line_items = cart.lineItems.digitalItems;
                        let last_digital_item = digital_line_items[digital_line_items.length - 1];
                        brand = last_digital_item.brand;
                    }
                    site_info = checkout.get_site_url_and_logo(cart, brand);
                    if( site_info && site_info !== undefined ){
                        console.log('site info: ');
                        console.log(site_info);
                        return (
                            <CheckoutHeader siteUrl={site_info[0]} logoUrl={site_info[1]} />
                        )
                    }
                }
            }, 5000);

            
            if( times_up && ! checkout_branded ){
                return (
                    <CheckoutHeader siteUrl={'https://bestop.com'} logoUrl={'https://www.bestop.com/wp-content/themes/bestop/images/bestop-logo.svg'} />
                )
            }*/
        }
    }

    private get_site_url_and_logo(cart?: Cart, brand?: string): string[] {
        let site = '';
        let siteUrl = '';
        let logoUrl = '';
        if( cart !== undefined && brand !== undefined ){
            console.log('brand:'+brand);
            switch( brand ){
                case 'Softopper': case 'softopper': case 'softopperstg':
                    site = 'softopper';
                    siteUrl = 'https://softopper.com';
                    logoUrl = 'https://softopper.com/wp-content/themes/softopper/images/logo-softopper.svg';
                    break;
                case 'Bestop': case 'bestop': case 'bestopstaging':
                    site = 'bestop';
                    siteUrl = 'https://bestop.com';
                    logoUrl = 'https://www.bestop.com/wp-content/themes/bestop/images/bestop-logo.svg';
                    break;
                case 'Tuffy Security Products': case 'tuffy': case 'tuffystg':
                    site = 'tuffy';
                    siteUrl = 'https://tuffyproducts.com';
                    logoUrl = 'https://tuffyproducts.com/wp-content/themes/tuffy/images/tuffy-logo.svg';
                    break;
                case 'Baja Designs': case 'bajadesigns': case 'bajadesignsdev': 
                    site = 'baja';
                    siteUrl = 'https://www.bajadesigns.com';
                    logoUrl = 'https://www.bajadesigns.com/wp-content/themes/bajadesigns/images/bajadesigns-logo-white.svg';
                    break;
                case 'PRP Seats': case 'prpseats': case 'prp-seats': case 'prpseatsdev':
                    site = 'prpseats';
                    siteUrl = 'https://new.prpseats.com';
                    logoUrl = 'https://prpseats.wpengine.com/wp-content/themes/prpseats/images/prp-logo.svg';
                    break;
                case 'offroadsourceDEV': case 'offroadsource': 
                    site = 'offroadsource';
                    siteUrl = 'https://offroadsource.com/';
                    logoUrl = 'https://offroadsource.com/wp-content/themes/bronco/assets/images/offroad-source-logo.svg';
                    break;
                default:
                    site = 'bestop';
                    siteUrl = 'https://bestop.com';
                    logoUrl = 'https://www.bestop.com/wp-content/themes/bestop/images/bestop-logo.svg';
            }

            const link = siteUrl+'/cart/';
            this.updateCartHeaderLink(link);
            const header_content_container = document.querySelector('header.checkoutHeader');
            const checkout_content_container = document.getElementById('checkout-app');
            const body = document.querySelector('body');
            if( header_content_container ){
                header_content_container.classList.add(site);
            }
            if( checkout_content_container ){
                checkout_content_container.classList.add(site);
            } 
            if( body ){
                body.classList.add(site);
            } 
            
        }
        return [siteUrl, logoUrl];
    }

    private renderStep(step: CheckoutStepStatus): ReactNode {
        switch (step.type) {
        case CheckoutStepType.Customer:
            return this.renderCustomerStep(step);

        case CheckoutStepType.Shipping:
            return this.renderShippingStep(step);

        case CheckoutStepType.Billing:
            return this.renderBillingStep(step);

        case CheckoutStepType.Payment:
            return this.renderPaymentStep(step);

        default:
            return null;
        }
    }

    private renderCustomerStep(step: CheckoutStepStatus): ReactNode {
        const { isGuestEnabled } = this.props;

        const {
            customerViewType = isGuestEnabled ? CustomerViewType.Guest : CustomerViewType.Login,
        } = this.state;

        return (
            <CheckoutStep
                { ...step }
                heading={ <TranslatedString id="customer.customer_heading" /> }
                key={ step.type }
                onEdit={ this.handleEditStep }
                onExpanded={ this.handleExpanded }
                suggestion={ <CheckoutSuggestion /> }
                summary={
                    <CustomerInfo
                        onSignOut={ this.handleSignOut }
                        onSignOutError={ this.handleError }
                    />
                }
            >
                <LazyContainer>
                    <Customer
                        checkEmbeddedSupport={ this.checkEmbeddedSupport }
                        isEmbedded={ isEmbedded() }
                        onAccountCreated={ this.navigateToNextIncompleteStep }
                        onChangeViewType={ this.setCustomerViewType }
                        onContinueAsGuest={ this.navigateToNextIncompleteStep }
                        onContinueAsGuestError={ this.handleError }
                        onReady={ this.handleReady }
                        onSignIn={ this.navigateToNextIncompleteStep }
                        onSignInError={ this.handleError }
                        onUnhandledError={ this.handleUnhandledError }
                        viewType={ customerViewType }
                    />
                </LazyContainer>
            </CheckoutStep>
        );
    }

    private renderShippingStep(step: CheckoutStepStatus): ReactNode {
        const {
            hasCartChanged,
            cart,
            consignments = [],
        } = this.props;

        const {
            isBillingSameAsShipping,
            isMultiShippingMode,
        } = this.state;

        if (!cart) {
            return;
        }

        return (
            <CheckoutStep
                { ...step }
                heading={ <TranslatedString id="shipping.shipping_heading" /> }
                key={ step.type }
                onEdit={ this.handleEditStep }
                onExpanded={ this.handleExpanded }
                summary={ consignments.map(consignment =>
                    <div className="staticConsignmentContainer" key={ consignment.id }>
                        <StaticConsignment
                            cart={ cart }
                            compactView={ consignments.length < 2 }
                            consignment={ consignment }
                        />
                    </div>) }
            >
                <LazyContainer>
                    <Shipping
                        cartHasChanged={ hasCartChanged }
                        isBillingSameAsShipping={ isBillingSameAsShipping }
                        isMultiShippingMode={ isMultiShippingMode }
                        navigateNextStep={ this.handleShippingNextStep }
                        onCreateAccount={ this.handleShippingCreateAccount }
                        onReady={ this.handleReady }
                        onSignIn={ this.handleShippingSignIn }
                        onToggleMultiShipping={ this.handleToggleMultiShipping }
                        onUnhandledError={ this.handleUnhandledError }
                    />
                </LazyContainer>
            </CheckoutStep>
        );
    }

    private renderBillingStep(step: CheckoutStepStatus): ReactNode {
        const { billingAddress } = this.props;

        return (
            <CheckoutStep
                { ...step }
                heading={ <TranslatedString id="billing.billing_heading" /> }
                key={ step.type }
                onEdit={ this.handleEditStep }
                onExpanded={ this.handleExpanded }
                summary={ billingAddress && <StaticBillingAddress address={ billingAddress } /> }
            >
                <LazyContainer>
                    <Billing
                        navigateNextStep={ this.navigateToNextIncompleteStep }
                        onReady={ this.handleReady }
                        onUnhandledError={ this.handleUnhandledError }
                    />
                </LazyContainer>
            </CheckoutStep>
        );
    }

    private renderPaymentStep(step: CheckoutStepStatus): ReactNode {
        const {
            consignments,
            cart,
        } = this.props;

        return (
            <CheckoutStep
                { ...step }
                heading={ <TranslatedString id="payment.payment_heading" /> }
                key={ step.type }
                onEdit={ this.handleEditStep }
                onExpanded={ this.handleExpanded }
            >
                <LazyContainer>
                    <Payment
                        checkEmbeddedSupport={ this.checkEmbeddedSupport }
                        isEmbedded={ isEmbedded() }
                        isUsingMultiShipping={ cart && consignments ? isUsingMultiShipping(consignments, cart.lineItems) : false }
                        onCartChangedError={ this.handleCartChangedError }
                        onFinalize={ this.navigateToOrderConfirmation }
                        onReady={ this.handleReady }
                        onSubmit={ this.navigateToOrderConfirmation }
                        onSubmitError={ this.handleError }
                        onUnhandledError={ this.handleUnhandledError }
                    />
                </LazyContainer>
            </CheckoutStep>
        );
    }

    private renderCartSummary(): ReactNode {
        return (
            <MobileView>
                { matched => {
                    if (matched) {
                        return <LazyContainer>
                            <CartSummaryDrawer />
                        </LazyContainer>;
                    }

                    return <aside className="layout-cart">
                        <LazyContainer>
                            <CartSummary />
                        </LazyContainer>
                    </aside>;
                } }
            </MobileView>
        );
    }

    private navigateToStep(type: CheckoutStepType, options?: { isDefault?: boolean }): void {
        const { clearError, error, steps } = this.props;
        const { activeStepType } = this.state;
        const step = find(steps, { type });

        if (!step) {
            return;
        }

        if (activeStepType === step.type) {
            return;
        }

        if (options && options.isDefault) {
            this.setState({ defaultStepType: step.type });
        } else {
            this.setState({ activeStepType: step.type });
        }

        if (error) {
            clearError(error);
        }
    }

    private handleToggleMultiShipping: () => void = () => {
        const { isMultiShippingMode } = this.state;

        this.setState({ isMultiShippingMode: !isMultiShippingMode });
    };

    private navigateToNextIncompleteStep: (options?: { isDefault?: boolean }) => void = options => {
        const { steps } = this.props;
        const activeStepIndex = findIndex(steps, { isActive: true });
        const activeStep = activeStepIndex >= 0 && steps[activeStepIndex];

        if (!activeStep) {
            return;
        }

        const previousStep = steps[Math.max(activeStepIndex - 1, 0)];

        if (previousStep && this.stepTracker) {
            this.stepTracker.trackStepCompleted(previousStep.type);
        }

        this.navigateToStep(activeStep.type, options);
    };

    private navigateToOrderConfirmation: (orderId?: number) => void = orderId => {
        const { steps } = this.props;
        const { isBuyNowCartEnabled } = this.state;

        if (this.stepTracker) {
            this.stepTracker.trackStepCompleted(steps[steps.length - 1].type);
        }

        if (this.embeddedMessenger) {
            this.embeddedMessenger.postComplete();
        }

        this.setState({ isRedirecting: true }, () => {
            navigateToOrderConfirmation(isBuyNowCartEnabled, orderId);
        });
    };

    private checkEmbeddedSupport: (methodIds: string[]) => boolean = methodIds => {
        const { embeddedSupport } = this.props;

        return embeddedSupport.isSupported(...methodIds);
    };

    private handleCartChangedError: (error: CartChangedError) => void = () => {
        this.navigateToStep(CheckoutStepType.Shipping);
    };

    private handleConsignmentsUpdated: (state: CheckoutSelectors) => void = ({ data }) => {
        const {
            hasSelectedShippingOptions: prevHasSelectedShippingOptions,
            activeStepType,
        } = this.state;

        const { steps } = this.props;

        const newHasSelectedShippingOptions = hasSelectedShippingOptions(data.getConsignments() || []);

        if (prevHasSelectedShippingOptions &&
            !newHasSelectedShippingOptions &&
            findIndex(steps, { type: CheckoutStepType.Shipping }) < findIndex(steps, { type: activeStepType })
        ) {
            this.navigateToStep(CheckoutStepType.Shipping);
            this.setState({ error: new ShippingOptionExpiredError() });
        }

        this.setState({ hasSelectedShippingOptions: newHasSelectedShippingOptions });
    };

    private handleCloseErrorModal: () => void = () => {
        this.setState({ error: undefined });
    };

    private handleExpanded: (type: CheckoutStepType) => void = type => {
        if (this.stepTracker) {
           this.stepTracker.trackStepViewed(type);
        }
    };

    private handleUnhandledError: (error: Error) => void = error => {
        this.handleError(error);

        // For errors that are not caught and handled by child components, we
        // handle them here by displaying a generic error modal to the shopper.
        this.setState({ error });
    };

    private handleError: (error: Error) => void = error => {
        const { errorLogger } = this.props;

        errorLogger.log(error);

        if (this.embeddedMessenger) {
            this.embeddedMessenger.postError(error);
        }
    };

    private handleEditStep: (type: CheckoutStepType) => void = type => {
        this.navigateToStep(type);
    };

    private handleReady: () => void = () => {
        this.navigateToNextIncompleteStep({ isDefault: true });
    };

    private handleSignOut: (event: CustomerSignOutEvent) => void = ({ isCartEmpty }) => {
        const { loginUrl, isGuestEnabled } = this.props;

        if (this.embeddedMessenger) {
            this.embeddedMessenger.postSignedOut();
        }

        if (isGuestEnabled) {
            this.setCustomerViewType(CustomerViewType.Guest);
        }

        if (isCartEmpty) {
            this.setState({ isCartEmpty: true });

            if (!isEmbedded()) {
                return window.top.location.assign(loginUrl);
            }
        }

        this.navigateToStep(CheckoutStepType.Customer);
    };

    private handleShippingNextStep: (isBillingSameAsShipping: boolean) => void = isBillingSameAsShipping => {
        this.setState({ isBillingSameAsShipping });

        if (isBillingSameAsShipping) {
            this.navigateToNextIncompleteStep();
        } else {
            this.navigateToStep(CheckoutStepType.Billing);
        }
    };

    private handleShippingSignIn: () => void = () => {
        this.setCustomerViewType(CustomerViewType.Login);
    };

    private handleShippingCreateAccount: () => void = () => {
        this.setCustomerViewType(CustomerViewType.CreateAccount);
    };

    private setCustomerViewType: (viewType: CustomerViewType) => void = customerViewType => {
        const {
            canCreateAccountInCheckout,
            createAccountUrl,
        } = this.props;

        if (customerViewType === CustomerViewType.CreateAccount &&
            (!canCreateAccountInCheckout || isEmbedded())
        ) {
            window.top.location.replace(createAccountUrl);

            return;
        }

        this.navigateToStep(CheckoutStepType.Customer);
        this.setState({ customerViewType });
    };
}

export default withLanguage(withCheckout(mapToCheckoutProps)(Checkout));
